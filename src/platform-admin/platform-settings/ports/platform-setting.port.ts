/**
 * Cross-boundary read port — the Slice-3 consolidation of what used to be
 * two separate ports, `FeatureFlagPort` (boolean gate) and
 * `PlatformCredentialPort` (decrypted secret). Both reads now live on ONE
 * port because they both read from the same, merged `PlatformSetting`
 * table — see that model's own header comment
 * (`prisma/schema.prisma`) for why. Any consumer module (callers:
 * `src/auth/services/social-login.service.ts` for `isEnabled`,
 * `src/auth/adapters/jose-social-identity-validation.adapter.ts` for
 * `getValue`) may import `PlatformSettingsModule` to reach this port; it
 * must never reach into `PlatformSettingsRepository`/Prisma directly.
 */
export abstract class PlatformSettingPort {
  /**
   * Whether the given setting `key` is currently "enabled" — i.e. its
   * stored `value` is the literal string `"true"`. A MISSING setting row
   * (unseeded/typo'd key) resolves to `true` (fail-open), not `false` — the
   * same deliberate trade-off the original `FeatureFlagPort.isEnabled` doc
   * comment documented: this gate exists to let ops turn an
   * already-working feature OFF, not to require every consumer feature to
   * be explicitly opted in before it silently starts failing if a seed
   * hasn't run yet. An EXISTING row whose value isn't exactly `"true"`
   * (including an encrypted row, whose `value` column is always `null` per
   * the DB CHECK constraint — a configuration mistake this port doesn't
   * attempt to work around) resolves to `false`.
   */
  abstract isEnabled(key: string): Promise<boolean>;

  /**
   * Returns the plain, usable value for `key` — DECRYPTED when the stored
   * row is encrypted, returned as-is when it isn't. Named `getValue` (not
   * `getDecryptedValue`) precisely BECAUSE decryption is no longer always
   * what happens here: whether a given key's row is encrypted is a
   * per-environment/per-row configuration detail (e.g.
   * `customer.social-login.google.client-id` is a public OAuth client-id,
   * not a secret, and is expected to be stored non-encrypted — see
   * `admin-panel/js/settings.js`'s `KNOWN_SETTING_SLOTS` — but nothing here
   * assumes that for every key/environment), not something a caller like
   * `JoseSocialIdentityValidationAdapter` needs to know or branch on.
   *
   * Returns `null` if no `PlatformSetting` row exists for `key` yet.
   * Deliberately `null`, not an empty string or a thrown error — every
   * caller MUST treat `null` as "not configured" and fail closed with its
   * own specific, non-generic error (see `socialLoginMisconfigured` in
   * `src/auth/errors/social-login-misconfigured.error.ts` for the
   * reference case), never silently proceed with a missing credential.
   */
  abstract getValue(key: string): Promise<string | null>;
}
