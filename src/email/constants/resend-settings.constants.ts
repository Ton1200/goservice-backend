/**
 * `PlatformSetting.key` dot-paths gating/configuring the Resend
 * transactional-email provider (GOS-3x follow-up, 2026-08-10) — mirrors
 * `customer.social-login.<provider>.<field>`'s namespace convention exactly
 * (see `PlatformSetting`'s own header comment in `prisma/schema.prisma`),
 * under a new `notifications.email.<provider>.<field>` prefix.
 * Deliberately namespaced by PROVIDER (`resend`), not flat, so a future
 * second provider (e.g. `notifications.email.sendgrid.enabled` +
 * its own `.api-key`/`.from-address`/`.from-name`) coexists at the same
 * level without any change to this file's shape — see
 * `EnsureEmailDeliveryAvailableService` for the "is ANY configured provider
 * enabled+ready" question this enables.
 *
 * Consumed by both `EnsureEmailDeliveryAvailableService` (the upfront gate)
 * and `ResendEmailClientAdapter` (the actual send, read live per-call) so
 * the two never drift on the literal key strings.
 */
export const RESEND_PLATFORM_SETTING_KEYS = {
  enabled: 'notifications.email.resend.enabled',
  apiKey: 'notifications.email.resend.api-key',
  fromAddress: 'notifications.email.resend.from-address',
  fromName: 'notifications.email.resend.from-name',
} as const;
