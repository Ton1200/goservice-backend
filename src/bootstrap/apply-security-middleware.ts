import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import cors from 'cors';
import helmet from 'helmet';
import type { AppConfig } from '../config/configuration';

/**
 * Applies the app's CORS + `helmet` security-header middleware to `app`.
 *
 * Shared between `main.ts` (the real process) and
 * `test/support/test-app.ts` (e2e tests built via
 * `TestingModule`/`createNestApplication()`, which bypasses `main.ts`'s own
 * `bootstrap()` entirely) so the two configurations can never drift out of
 * sync — the same class of "two things that are supposed to always agree,
 * but silently don't" risk already named for the `ServeStaticModule`
 * `exclude` / `GraphQLModule` `path` pairing in `app.module.ts` (see ADR
 * 0005).
 */
export function applySecurityMiddleware(
  app: INestApplication,
  configService: ConfigService<AppConfig, true>,
): void {
  // --- CORS: scoped to the PUBLIC consumer /graphql endpoint only ---
  //
  // Deliberately NOT `app.enableCors(...)` (a global call) — that would
  // apply the SAME origin allowlist meant for the Expo Web dev server
  // hitting the public `/graphql` endpoint to the platform-admin panel and
  // its isolated GraphQL endpoint too, even though the admin panel is
  // same-origin (served by this same app, under `${adminPanelPath}`) and
  // has zero legitimate cross-origin callers.
  //
  // `app.use('/graphql', cors(...))` mounts the `cors` middleware ONLY on
  // requests whose path starts with `/graphql` — the public endpoint's
  // fixed path (see `src/app.module.ts`'s first `GraphQLModule.forRootAsync()`
  // registration). Every other route on this app — including
  // `${adminPanelPath}` and `${adminPanelPath}/graphql` — receives NO
  // `Access-Control-Allow-Origin` header at all, so a real browser (unlike
  // curl/Jest, which don't enforce CORS) blocks any cross-origin request to
  // those routes by default, with no explicit denial code needed on this
  // end.
  const corsAllowedOrigins = configService.get('corsAllowedOrigins', {
    infer: true,
  });
  app.use('/graphql', cors({ origin: corsAllowedOrigins }));

  // --- helmet: security headers, applied globally ---
  //
  // A real, non-default Content-Security-Policy — deliberately NOT using
  // `'unsafe-inline'` as a shortcut for `script-src`/`style-src`. This is
  // only possible because `admin-panel/index.html`'s former inline
  // `<script type="module">...</script>` bootstrap block was extracted to
  // `admin-panel/js/bootstrap.js` (an external, same-origin file — see that
  // file's header comment), and the panel has no inline `style="..."`
  // attributes anywhere (grepped, not assumed) and no external/CDN
  // resources at all (Tabler's CSS/JS are vendored locally under
  // `admin-panel/vendor/`, with no external `url(...)`/`@font-face`
  // references, and no cross-origin fetches) — so `'self'` is a genuinely
  // correct, non-breaking source for every directive below, not just an
  // aspirational one — with one confirmed, deliberate exception: `imgSrc`
  // also allows `data:`. Bootstrap's native `.form-check.form-switch`
  // checkbox (originally added for the admin panel's now-removed "Público"
  // toggle, Slice 3; reused as of the 2026-08-08 restyle for the
  // Enabled/Disabled feature-flag switch itself — see
  // `admin-panel/js/settings.js`'s `renderFlagField`) draws its thumb/track
  // via a `background-image: url("data:image/svg+xml,...")` baked into the
  // vendored `tabler.min.css` itself — confirmed live via Playwright: with
  // only `'self'`, every such checkbox threw real CSP violations, blocking
  // the image (function was unaffected, but the control rendered without
  // its visual thumb). `data:` images can't execute script — unlike
  // `'unsafe-inline'` for `script-src`, this is a standard, low-risk CSP
  // allowance, not a meaningful weakening.
  app.use(
    helmet({
      contentSecurityPolicy: {
        // `useDefaults: true` (helmet's own default) merges these
        // directives with helmet's baseline CSP: any directive listed
        // here REPLACES that directive's helmet default; any directive
        // NOT listed here keeps helmet's own default. Listed explicitly
        // to avoid inheriting helmet's default `style-src 'self' https:
        // 'unsafe-inline'`, which would silently reintroduce the exact
        // thing this change is meant to remove.
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          // Modern CSP equivalent of `X-Frame-Options: DENY` (clickjacking
          // protection). Kept alongside helmet's own `X-Frame-Options`
          // header (set by default, see below) rather than instead of it —
          // the two are complementary across older/newer browsers, not
          // redundant.
          frameAncestors: ["'none'"],
        },
      },
      // Every other helmet default (X-Content-Type-Options: nosniff,
      // X-Frame-Options: DENY, Cross-Origin-Opener-Policy,
      // Origin-Agent-Cluster, Strict-Transport-Security, etc.) is left as
      // helmet ships it — nothing about this app needs a different value
      // for any of those. See the final report for what helmet actually
      // applied, verified via `curl -I` against a running dev server.
    }),
  );
}
