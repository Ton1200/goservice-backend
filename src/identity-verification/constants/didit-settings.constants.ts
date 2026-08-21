/**
 * `PlatformSetting.key` dot-paths gating/configuring the Didit identity
 * verification provider — mirrors `RESEND_PLATFORM_SETTING_KEYS`'s exact
 * convention (`src/email/constants/resend-settings.constants.ts`):
 * provider-namespaced under `identity.didit.*`, so a future second provider
 * (`identity.<other-provider>.*`) coexists without any change to this
 * file's shape. Consumed by `IdentityVerificationProviderRegistry` (the 2
 * global kill switches) and `DiditIdentityVerificationAdapter` (mode-aware
 * credential reads, resolved live per-call — never cached).
 *
 * `identity.routing.<country>.enabled` (a former per-country routing key)
 * was REMOVED (2026-08-15, human-requested simplification) — see
 * `IdentityVerificationProviderRegistry`'s own header comment for the
 * rationale: Didit is the sole provider and already covers every country in
 * `CountryCode`, so a country-level `PlatformSetting` gate on top added no
 * real value.
 *
 * `identity.didit.callback-url` (the post-verification browser-redirect
 * URL, distinct from the webhook) was also REMOVED (2026-08-17,
 * human-requested simplification): GOS-33 is backend-only, no mobile
 * deep-link/screen exists yet to redirect to, and `createSession` never
 * depended on it for correctness — Didit falls back to its own generic
 * completion page, and the real result still always arrives via the
 * webhook regardless. Re-add it (as its own `PlatformSetting` key, same
 * shape as before) once a future mobile story has a real screen/deep-link
 * to point it at.
 */
/** `IdentityVerification.provider`'s value for every row created via
 * `DiditIdentityVerificationAdapter` — a plain string, not an enum (see
 * that column's own comment in `prisma/schema.prisma`). */
export const DIDIT_PROVIDER_NAME = 'didit';

export const IDENTITY_PLATFORM_SETTING_KEYS = {
  enabled: 'identity.enabled',
  diditEnabled: 'identity.didit.enabled',
  diditMode: 'identity.didit.mode',
} as const;

/** The two supported values of `identity.didit.mode` — a plain string
 * union (not a Prisma/GraphQL enum): this is an internal, backend-only
 * operational selector, never exposed to any client (see the plan's own
 * "Nota deliberada sobre qué se expone al frontend"). */
export type DiditMode = 'SANDBOX' | 'PRODUCTION';

const DEFAULT_DIDIT_MODE: DiditMode = 'SANDBOX';

/**
 * Normalizes whatever raw string `identity.didit.mode` currently holds
 * (including a never-configured/missing row) into a real `DiditMode` —
 * fails closed to `SANDBOX`, never `PRODUCTION`, so a missing/corrupted
 * setting can never accidentally point real user traffic at a production
 * Didit Application.
 */
export function parseDiditMode(raw: string | null): DiditMode {
  return raw === 'PRODUCTION' ? 'PRODUCTION' : DEFAULT_DIDIT_MODE;
}

/** `identity.didit.<mode>.api-key` / `.workflow-id` / `.webhook-secret` —
 * the 3 mode-scoped credential keys `DiditIdentityVerificationAdapter`
 * reads, resolved against whichever `DiditMode` is currently active. */
export function diditModeSettingKeys(mode: DiditMode): {
  apiKey: string;
  workflowId: string;
  webhookSecret: string;
} {
  const prefix = `identity.didit.${mode.toLowerCase()}`;
  return {
    apiKey: `${prefix}.api-key`,
    workflowId: `${prefix}.workflow-id`,
    webhookSecret: `${prefix}.webhook-secret`,
  };
}
