// GOS-14/GOS-28 — minimal read-only Category catalog. No CRUD, no GraphQL
// mutation ever creates/updates/deletes a Category; this is the ONLY place
// Category rows are created. Run via `npm run prisma:seed`
// (`prisma db seed`, wired in package.json's `prisma.seed` config).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Matches the product vision's example service list (CLAUDE.md) — plumbing,
// electricity, carpentry, fencing, painting, gardening, cleaning, general
// maintenance, appliance repair.
const CATEGORIES = [
  'Plomería',
  'Electricidad',
  'Carpintería',
  'Cercado',
  'Pintura',
  'Jardinería',
  'Limpieza',
  'Mantenimiento general',
  'Reparación de electrodomésticos',
] as const;

// GOS-30/31/32 (platform-admin) — the two boolean `PlatformSetting` rows the
// reference case (gating `SocialLoginService`) depends on. Both default
// `value: 'true'` — the point of the setting is letting an admin turn an
// already-working provider OFF during an incident, not requiring an opt-in
// before it works at all. Upserted here (not by
// `scripts/bootstrap-super-admin.ts`) since this file is already the
// project's one seeding mechanism for reference/catalog data (`npm run
// prisma:seed`), same idempotent upsert-by-key pattern as `Category` above.
//
// `isEncrypted: false` (these are plain on/off switches, not secrets) AND
// `isPublic: true` (GOS-3x follow-up #2, 2026-08-10 — `isPublic` is back as
// its own independent, default-OFF gate; see `PlatformSetting`'s own header
// comment in `prisma/schema.prisma`) — BOTH are now required for a row to
// be automatically visible via `platformConfig`, which is exactly the kind
// of thing `goservice-mobile` needs to know about before showing a "Sign in
// with Google" button; see `src/platform-admin/platform-settings/public/`.
// The corresponding
// `customer.social-login.<provider>.client-id` credential (`isEncrypted:
// true`) is NOT seeded here — an admin must configure it via
// `setPlatformSetting` in the panel; see `SOCIAL_LOGIN_MISCONFIGURED` in
// `src/auth/errors/social-login-misconfigured.error.ts` for what happens
// until they do.
//
// `FeatureFlag`/`PlatformCredential` (the two-model design this superseded)
// were both dropped by the consolidation migration
// (`20260808210000_consolidate_platform_settings`) — there is no legacy
// table/data left to clean up here anymore; a fresh `PlatformSetting` table
// only ever has what this seed (and the admin panel) puts into it.
// GOS-3x follow-up (2026-08-10) — Resend transactional-email provider
// config, migrated from `.env`/`ConfigService` to admin-managed
// `PlatformSetting` rows, mirroring the social-login pattern above:
// `notifications.email.resend.<field>`. See
// `src/email/constants/resend-settings.constants.ts` for the key
// constants, and `src/email/services/ensure-email-delivery-available.service.ts`
// for the upfront gate `register`/`resendVerificationCode`/
// `requestPasswordReset` now all call first.
//
// `enabled` is DELIBERATELY seeded `'false'` (fail-closed), unlike the
// social-login flags above: no real Resend API key exists to seed
// alongside it, so `enabled: true` with no key would be a broken
// half-state. An admin must flip this on AND enter the real key together,
// in one deliberate activation step via the panel. `isPublic: false` (not
// `true`, unlike the social-login flags): this is backend-only
// configuration — the mobile app has no reason to know whether email
// delivery is enabled.
//
// `from-name` is seeded `'GoService'`, matching the pre-migration
// `EMAIL_FROM_NAME` env var's own default, so any environment that never
// customized it keeps the same behavior after this migration.
//
// `api-key` (a real secret, `isEncrypted: true`) and `from-address` are
// deliberately NOT seeded here — no safe/real default exists for either.
// They render in the admin panel via the generalized `KNOWN_SETTING_SLOTS`
// mechanism (`admin-panel/js/settings.js`) as "not configured yet"
// placeholders instead, exactly like Google/Apple's `client-id` do today.
const PLATFORM_SETTINGS: {
  key: string;
  description: string;
  value: string;
  isPublic?: boolean;
  // Optional, explicit override for rows where the existing "'true'/'false'
  // -> BOOLEAN, anything else -> STRING" heuristic below gets it wrong —
  // added alongside the first NUMBER row (`admin.session.timeout-minutes`,
  // 2026-08-11 follow-up), whose value ('30') is neither 'true' nor
  // 'false' but also isn't a STRING setting. Every existing row leaves this
  // unset and keeps relying on the heuristic — never added retroactively
  // just for consistency.
  valueType?: 'BOOLEAN' | 'STRING' | 'NUMBER';
}[] = [
  {
    key: 'customer.social-login.google.enabled',
    description: 'Gates Google sign-in (socialLogin GOOGLE).',
    value: 'true',
    isPublic: true,
  },
  {
    key: 'customer.social-login.apple.enabled',
    description: 'Gates Apple sign-in (socialLogin APPLE).',
    value: 'true',
    isPublic: true,
  },
  {
    key: 'notifications.email.resend.enabled',
    description:
      'Gates the Resend transactional-email provider (register/resendVerificationCode/requestPasswordReset).',
    value: 'false',
    isPublic: false,
  },
  {
    key: 'notifications.email.resend.from-name',
    description: 'Display name used alongside the Resend from-address.',
    value: 'GoService',
    isPublic: false,
  },
  // GOS-3x follow-up (2026-08-11) — was ADMIN_SESSION_TTL_MINUTES, a
  // boot-time env var (REMOVED, not deprecated); admin-configurable now,
  // matching the same env-var-to-PlatformSetting migration pattern as the
  // Resend rows above. See
  // `src/platform-admin/admin-auth/adapters/postgres-admin-session.adapter.ts`
  // for where this is read (fresh, on every login — never cached) and its
  // own defensive fallback (also `30`) if this row is ever missing.
  // `isPublic: false` — this is an internal admin-tool setting, the mobile
  // app has no reason to ever read it.
  {
    key: 'admin.session.timeout-minutes',
    description:
      'How long an admin session stays valid after login, in minutes.',
    value: '30',
    isPublic: false,
    valueType: 'NUMBER',
  },
  // Identity Verification (Didit integration) — every toggle below starts
  // OFF/empty by default, unlike the social-login flags above: no real
  // Didit account/credentials exist yet, and this is a much higher-stakes
  // capability (it drives real account approval/rejection) to ever
  // accidentally leave on. An admin must deliberately load real sandbox
  // credentials AND flip these on together — see
  // `src/identity-verification/constants/didit-settings.constants.ts` for
  // the full key reference these mirror, and that module's own README-style
  // header comments for the runtime behavior each key drives.
  //
  // `identity.enabled` — the GLOBAL kill switch. `isPublic: true`: exposed
  // via the unauthenticated `platformConfig` query (as `identity.enabled`
  // in its nested tree) so mobile can decide whether to offer/attempt the
  // identity-verification flow at all, without a mobile deploy — see
  // `src/platform-admin/platform-settings/public/known-platform-config-defaults.ts`,
  // which also registers this key so it always has a present (default
  // `false`) branch in that response even before this seed has run.
  {
    key: 'identity.enabled',
    description:
      'Global kill switch for identity verification (gates startIdentityVerification).',
    value: 'false',
    isPublic: true,
  },
  // `identity.didit.enabled` — the Didit-PROVIDER-specific kill switch
  // (distinct from `identity.enabled` so an incident with Didit itself, or
  // a future second provider, can be toggled independently of the whole
  // feature). `isPublic: false`: this is an internal provider detail, not
  // something a mobile client needs to branch on — it only ever needs to
  // know "is identity verification available AT ALL" (`identity.enabled`).
  //
  // A former `identity.routing.AR.enabled`/`identity.routing.CO.enabled`
  // pair of per-country routing switches was REMOVED here (2026-08-15,
  // human-requested simplification) — see
  // `IdentityVerificationProviderRegistry`'s own header comment: Didit is
  // the sole provider and already covers every `CountryCode`, so these two
  // switches alone (`identity.enabled` + `identity.didit.enabled`) are now
  // the entire gate.
  {
    key: 'identity.didit.enabled',
    description: 'Gates the Didit identity-verification provider specifically.',
    value: 'false',
    isPublic: false,
  },
  // `identity.didit.mode` — selects which of the two credential sets below
  // (`sandbox.*` / `production.*`) `DiditIdentityVerificationAdapter`
  // actually reads on every call. Defaults to SANDBOX (never PRODUCTION) —
  // see `parseDiditMode`'s own fail-closed rationale in
  // `didit-settings.constants.ts`. `isPublic: false` — purely an
  // operational/backend concern, see `platformConfig`'s own "Nota
  // deliberada" in the implementation plan for why this is deliberately
  // NEVER exposed to the client, even indirectly.
  {
    key: 'identity.didit.mode',
    description: 'Which Didit credential set is active: SANDBOX or PRODUCTION.',
    value: 'SANDBOX',
    isPublic: false,
  },
  // `identity.didit.sandbox.api-key` / `.workflow-id` / `.webhook-secret`
  // and their `production.*` counterparts are DELIBERATELY NOT seeded here
  // at all — same "no safe default exists" reasoning as
  // `notifications.email.resend.api-key`/`.from-address` above: an admin
  // must configure them for the first time via `setPlatformSetting` in the
  // panel. They render as "not configured yet" placeholders there via the
  // generalized `KNOWN_SETTING_SLOTS` mechanism
  // (`admin-panel/js/settings.js`) instead. `.api-key`/`.webhook-secret`
  // (both modes) are real secrets (`isEncrypted: true`); `.workflow-id`
  // is not a secret but still has no safe default value.
  //
  // `identity.didit.callback-url` (the post-verification browser-redirect
  // URL) was REMOVED entirely (2026-08-17, human-requested simplification)
  // — GOS-33 is backend-only, no mobile deep-link/screen exists yet to
  // point it at, and `createSession` never depended on it for correctness.

  {
    key: 'maps.google.enabled',
    description:
      'Gates the Google Geocoding provider (server-side address -> coordinates for CustomerProfile).',
    value: 'false',
    isPublic: false,
  },
  // GOS-53 — Quote Negotiation feature flags. The ticket's own "hardcoded
  // fallback" values are seeded here as REAL, admin-toggleable
  // `PlatformSetting` rows instead — see
  // `src/quote-negotiation/quote-negotiation.module.ts`'s own header
  // comment for the full "no FeatureFlagPort/FeatureFlagGroup exists, the
  // real successor is PlatformSettingPort" investigation this decision is
  // based on. All three read via `PlatformSettingPort.isEnabled(key)` —
  // never a hardcoded TS constant.
  //
  // `quote-negotiation.general.enabled` — the GLOBAL kill switch for the
  // whole capability (comments + price proposals). `isPublic: false`: this
  // is a backend/admin-only gate, not something `goservice-mobile` needs to
  // branch on ahead of time the way `identity.enabled` above does — the
  // mobile client just calls the mutations/query and handles
  // `QUOTE_NEGOTIATION_MODULE_DISABLED` like any other domain error.
  {
    key: 'quote-negotiation.general.enabled',
    description:
      'Global kill switch for the Quote Negotiation capability (postQuoteNegotiationMessage/acceptQuotePriceProposal/rejectQuotePriceProposal/quoteNegotiationMessages).',
    value: 'true',
    isPublic: false,
  },
  // `quote-negotiation.price-edit.customer-can-propose` /
  // `.professional-can-propose` — independent, role-specific gates on
  // whether that role may attach a `proposedPrice` to a negotiation
  // message. Defaults match the ticket's own specified fallback: a
  // Customer proposing a price is OFF by default, a Professional
  // countering is ON by default. `isPublic: false` — same reasoning as
  // `general.enabled` above.
  {
    key: 'quote-negotiation.price-edit.customer-can-propose',
    description:
      'Whether a Customer may attach a price proposal to a Quote Negotiation message.',
    value: 'false',
    isPublic: false,
  },
  {
    key: 'quote-negotiation.price-edit.professional-can-propose',
    description:
      'Whether a Professional may attach a price proposal to a Quote Negotiation message.',
    value: 'true',
    isPublic: false,
  },
  // GOS-46 follow-up — Engagement Chat ("Chat de Coordinación") admin
  // enable/disable toggle. Deliberately placed under the `customer.*` group
  // (human-requested, in a NEW `chat` sub-group), NOT a top-level
  // `engagement-chat.*` key like `quote-negotiation.general.enabled` above —
  // same dot-namespaced convention `customer.social-login.<provider>
  // .enabled` already establishes, so it automatically renders under
  // Customer > "Chat" in the admin panel's settings tree with zero frontend
  // code changes (`admin-panel/js/settings.js`'s `buildSettingsTree`/
  // `humanizeSegment` derive the tree purely from a key's dot-path — no
  // per-key special-casing exists or is needed). Read via
  // `PlatformSettingPort.isEnabled(key)` by the new
  // `EngagementChatModuleEnabledGuard` (`src/engagement-chat/guards/
  // engagement-chat-module-enabled.guard.ts`) — never a hardcoded TS
  // constant, same mechanism as `quote-negotiation.general.enabled` above.
  //
  // Renamed from `customer.engagement-chat.enabled` (2026-08-21 follow-up,
  // human-requested): "Engagement Chat" read as unnecessarily verbose in the
  // Settings tab next to the feature's actual name — just "Chat". Only the
  // key/Settings-group label changed; every `EngagementChat*` TS/GraphQL
  // identifier is unchanged. No real database row existed under the old key
  // yet at rename time (confirmed: this seed entry had never been applied
  // to `goservice_dev`), so this was a pure rename, not a data migration.
  //
  // `value: 'false'` (default OFF) — unlike `quote-negotiation.general.
  // enabled`'s default-ON, per explicit instruction for this feature.
  // `isPublic: false`: this is a backend/admin-only gate — `goservice-mobile`
  // doesn't need to know ahead of time whether Engagement Chat is enabled
  // via `platformConfig`; it just calls `sendEngagementMessage`/
  // `engagementMessages` and handles `ENGAGEMENT_CHAT_MODULE_DISABLED` like
  // any other domain error, same reasoning as the Quote Negotiation flags.
  {
    key: 'customer.chat.enabled',
    description:
      'Global kill switch for the Engagement Chat capability (sendEngagementMessage/engagementMessages). Does not gate adminEngagementChatThread.',
    value: 'false',
    isPublic: false,
  },
  // GOS-59 follow-up — Appointment ("Coordinación de Visita") admin
  // enable/disable toggle. Placed under the same `customer.*` group AS A
  // SIBLING of `customer.chat.enabled` above — NOT nested under it (`chat`
  // and `appointments` are two independent capability sub-groups, both
  // dot-namespaced under `customer.*`) — same convention, so this key
  // automatically renders under Customer > "Appointments" in the admin
  // panel's settings tree with zero frontend code changes
  // (`admin-panel/js/settings.js`'s `buildSettingsTree`/`humanizeSegment`
  // derive the tree purely from a key's dot-path — no per-key
  // special-casing exists or is needed). Read via
  // `PlatformSettingPort.isEnabled(key)` by the new
  // `AppointmentsModuleEnabledGuard` (`src/appointments/guards/
  // appointments-module-enabled.guard.ts`) — never a hardcoded TS constant,
  // same mechanism as `customer.chat.enabled`/`quote-negotiation.general.
  // enabled` above.
  //
  // `value: 'true'` (default ON) — UNLIKE `customer.chat.enabled`'s default
  // OFF: Appointment is an already-shipped, working capability (GOS-59) as
  // of this follow-up, not a new one being introduced gated-off; the point
  // of this switch is letting an admin turn it OFF during an incident, not
  // requiring an opt-in before it works at all (same "already-working
  // feature" default-ON reasoning as `quote-negotiation.general.enabled`
  // and the social-login flags above — `PlatformSettingPort.isEnabled`'s own
  // doc comment on fail-open-when-missing documents the same trade-off for
  // an unseeded/typo'd key).
  // `isPublic: false`: this is a backend/admin-only gate — `goservice-mobile`
  // doesn't need to know ahead of time whether Appointment is enabled via
  // `platformConfig`; it just calls `proposeAppointment`/etc. and handles
  // `APPOINTMENTS_MODULE_DISABLED` like any other domain error, same
  // reasoning as the Engagement Chat/Quote Negotiation flags.
  {
    key: 'customer.appointments.enabled',
    description:
      'Global kill switch for the Appointment capability (proposeAppointment/acceptAppointment/cancelAppointment/appointmentsByEngagement).',
    value: 'true',
    isPublic: false,
  },
];

async function main(): Promise<void> {
  for (const name of CATEGORIES) {
    // upsert-on-name makes the seed itself idempotent/re-runnable.
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  for (const setting of PLATFORM_SETTINGS) {
    // update: {} — an already-toggled setting's real `value` is never
    // clobbered back to its seeded default by re-running the seed.
    await prisma.platformSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: {
        key: setting.key,
        description: setting.description,
        // Explicit `valueType` wins when a row sets one (see that field's
        // own comment on the array's type above); otherwise falls back to
        // the original heuristic — `'true'`/`'false'` -> BOOLEAN, anything
        // else -> STRING (every pre-existing row here is boolean-or-string
        // shaped, so this stays correct for all of them unchanged).
        valueType:
          setting.valueType ??
          (setting.value === 'true' || setting.value === 'false'
            ? 'BOOLEAN'
            : 'STRING'),
        isEncrypted: false,
        isPublic: setting.isPublic ?? false,
        value: setting.value,
      },
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
