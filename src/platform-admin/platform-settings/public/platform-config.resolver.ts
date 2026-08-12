import { Query, Resolver } from '@nestjs/graphql';
import { JsonScalar } from '../../../common/graphql/json.scalar';
import { ListPlatformConfigService } from './services/list-platform-config.service';

/**
 * Consumer-facing (`/graphql`, NOT `/admin/graphql`) query — deliberately
 * carries NO auth guard. An unauthenticated mobile client legitimately
 * needs this (e.g. a login/landing screen deciding whether to render "Sign
 * in with Google" BEFORE the user has any session at all) — the same
 * reasoning `socialLogin`/`login`/`register` already aren't
 * `@UseGuards(SessionGuard)`-protected. This is safe specifically BECAUSE
 * of the layered guardrails on what this query can ever return: the
 * repository query is `isEncrypted = false AND isPublic = true` (BOTH gates
 * required — see `PlatformSetting`'s own header comment in
 * `prisma/schema.prisma`), and the returned tree is built exclusively from
 * those same rows' already-unwrapped values — see
 * `ListPlatformConfigService`'s own header comment.
 *
 * Reshaped a SECOND time (2026-08-09, same day, confirmed with the human
 * via a concrete JSON preview) from `[PlatformConfigGroup!]!` (one entry
 * per feature, each a flat `fields: JSON!` map, group key = dot-path with
 * its last segment dropped) to a single bare `JSON!` scalar: the whole
 * response is now ONE deeply nested object built from every dot-segment of
 * every non-encrypted setting's key, arbitrary depth, not just the fixed
 * two levels ("group" + "field") the prior shape had. `PlatformConfigGroup`
 * no longer exists — see `ListPlatformConfigService`'s own header comment
 * for the full before/after. Zero arguments, exactly as before — always
 * returns the full tree, never filtered.
 */
@Resolver()
export class PlatformConfigResolver {
  constructor(
    private readonly listPlatformConfigService: ListPlatformConfigService,
  ) {}

  @Query(() => JsonScalar, {
    description:
      'The full, deeply-nested tree of every non-encrypted, explicitly public platform setting (isEncrypted: false AND isPublic: true) — safe to read WITHOUT a session (e.g. a login screen deciding whether to show "Sign in with Google"). Each dot-segment of a setting\'s key (camelCased, e.g. `client-id` -> `clientId`) becomes one level of nesting; the leaf is the setting\'s own already-unwrapped typed value (boolean/string/number). Never includes an encrypted setting, and never includes a non-public one. Always returns the full tree; no filtering argument. Every KNOWN boolean feature flag (see `KNOWN_PLATFORM_CONFIG_BOOLEAN_DEFAULTS`) is always present, defaulting to `false` if never configured — everything else (e.g. a `clientId`, or a flag not yet added to that manifest) may still be legitimately absent.',
  })
  platformConfig(): Promise<Record<string, unknown>> {
    return this.listPlatformConfigService.listPlatformConfig();
  }
}
