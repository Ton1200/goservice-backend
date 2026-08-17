/**
 * A small, explicit manifest of KNOWN BOOLEAN feature-flag keys that must
 * always have a branch present in `platformConfig`'s response tree, even
 * before any admin has ever saved a `PlatformSetting` row for that key —
 * defaulting to `defaultValue` in that case.
 *
 * Why this exists (2026-08-10, human-requested fix): without this manifest,
 * `platformConfig`'s tree is built EXCLUSIVELY from whatever
 * `PlatformSetting` rows currently exist — a known flag with no row yet is
 * simply ABSENT from the tree, not `{ enabled: false }`. A mobile client
 * doing `config.customer?.socialLogin?.microsoft?.enabled` then gets
 * `undefined`, which is easy to mishandle (e.g. a careless `!== false`
 * check would treat "never configured" as "enabled"). See
 * `ListPlatformConfigService.listPlatformConfig()` for where this manifest
 * is consumed — real DB rows are always the higher-priority source; a
 * default here only fills a leaf that is otherwise completely missing, and
 * NEVER overwrites an already-saved value (including a saved `false`).
 *
 * Deliberately scoped to BOOLEANS ONLY — this is NOT a general mechanism
 * for defaulting arbitrary settings/string values. A `client-id` with no
 * configured value should still be legitimately ABSENT from the tree, not
 * defaulted to `''` — only booleans get this treatment, because "not
 * configured" and "false" are semantically equivalent for a feature-gate
 * flag (a feature that was never turned on behaves identically to one
 * explicitly turned off), whereas an empty-string credential/identifier is
 * NOT equivalent to "not configured" (it's a distinct, likely-broken state
 * a client should be able to tell apart from "absent").
 *
 * This mirrors the same "always render a known slot" precedent already
 * established client-side by `admin-panel/js/settings.js`'s
 * `KNOWN_SETTING_SLOTS` (a hardcoded list ensuring a known field always
 * renders in the admin panel even before a row exists) — but this manifest
 * lives server-side, because the guarantee it provides must hold for EVERY
 * consumer of `platformConfig` (any future mobile client, not just this one
 * admin panel that happens to also solve a related-but-distinct problem for
 * itself).
 *
 * Adding a new boolean feature flag to GoService does NOT automatically get
 * this guarantee — a flag not listed here is simply absent when
 * unconfigured, same as before this manifest existed. It must be added here
 * explicitly for `platformConfig` to always present its branch.
 */
export interface KnownPlatformConfigBooleanDefault {
  /** The `PlatformSetting.key` dot-path, exactly as stored (kebab-case
   * segments), e.g. `customer.social-login.google.enabled`. */
  key: string;
  /** The value used when no non-encrypted row exists yet for `key`. */
  defaultValue: boolean;
}

export const KNOWN_PLATFORM_CONFIG_BOOLEAN_DEFAULTS: ReadonlyArray<KnownPlatformConfigBooleanDefault> =
  [
    { key: 'customer.social-login.google.enabled', defaultValue: false },
    { key: 'customer.social-login.apple.enabled', defaultValue: false },
    // Identity Verification (Didit) — mobile needs `config.identity.enabled`
    // to decide whether to offer/attempt the `startIdentityVerification`
    // flow at all, WITHOUT a mobile deploy — same reasoning as the
    // social-login flags above. `identity.enabled` is ALSO seeded
    // (`prisma/seed.ts`, `false` by default) — listed here too purely for
    // the same defensive "renders correctly even before the seed has run"
    // reason `notifications.email.resend.enabled`'s sibling flags don't need
    // (that one is deliberately NOT public — see this file's own header
    // comment on why only booleans, and `prisma/seed.ts`'s comment on why
    // `identity.didit.enabled` itself is NOT public/listed here: it's a
    // provider detail, not a client-relevant signal).
    //
    // A former `identity.routing.AR.enabled`/`identity.routing.CO.enabled`
    // pair of per-country routing defaults was REMOVED here (2026-08-15,
    // human-requested simplification) — see
    // `IdentityVerificationProviderRegistry`'s own header comment: Didit is
    // the sole provider and already covers every `CountryCode`, so
    // `identity.enabled` + `identity.didit.enabled` alone are now the
    // entire gate, and no per-country signal exists for `platformConfig` to
    // expose anymore.
    { key: 'identity.enabled', defaultValue: false },
  ];
