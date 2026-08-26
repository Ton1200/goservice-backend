/**
 * `PlatformSetting.key` selecting WHICH email delivery channel is active —
 * added alongside Mailpit as a local-dev-only email catcher (see
 * `EmailProviderRouterAdapter`). Deliberately a SEPARATE key from
 * `notifications.email.resend.enabled`
 * (`../constants/resend-settings.constants.ts`): that key still gates
 * whether Resend itself is enabled+configured (needed regardless of which
 * channel is active, since Mailpit falling back to Resend — e.g. this key
 * missing, or set to `MAILPIT` while `NODE_ENV=production` — still requires
 * Resend to be properly configured). This key answers a different question:
 * "of the channels that ARE available, which one should actually be used
 * right now".
 *
 * A single STRING setting (not a second `.enabled` boolean per provider)
 * because the two channels are mutually exclusive by design — there is
 * always exactly ONE active channel, never "both enabled, first wins" —
 * mirrors `identity.didit.mode`'s (`SANDBOX`/`PRODUCTION`) shape exactly,
 * see `KNOWN_SETTING_SLOTS` in `admin-panel/js/settings.js`.
 *
 * Missing row / any value other than `MAILPIT` → treated as `RESEND` (the
 * production-safe default) — see `EmailProviderRouterAdapter` and
 * `EnsureEmailDeliveryAvailableService`.
 */
export const EMAIL_PROVIDER_SETTING_KEY = 'notifications.email.provider';

export const EMAIL_PROVIDERS = {
  RESEND: 'RESEND',
  MAILPIT: 'MAILPIT',
} as const;

export type EmailProviderValue =
  (typeof EMAIL_PROVIDERS)[keyof typeof EMAIL_PROVIDERS];
