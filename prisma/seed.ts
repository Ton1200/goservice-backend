// GOS-14/GOS-28 — minimal read-only Category catalog. No CRUD, no GraphQL
// mutation ever creates/updates/deletes a Category; this is the ONLY place
// Category rows are created. Run via `npm run prisma:seed`
// (`prisma db seed`, wired in package.json's `prisma.seed` config).
import { existsSync } from 'fs';
import { copyFile, mkdir } from 'fs/promises';
import { join } from 'path';
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
  // Added alongside Mailpit (local-dev-only email catcher, ADR 0004's dated
  // update) — selects which channel actually handles delivery:
  // `RESEND`/`MAILPIT`. Seeded `'RESEND'` (the production-safe default,
  // same choice `EmailProviderRouterAdapter` and
  // `EnsureEmailDeliveryAvailableService` fall back to for a missing row)
  // so a fresh environment behaves exactly as it did before this key
  // existed — nothing changes unless an admin deliberately switches it to
  // `MAILPIT` for local development. `isPublic: false` — backend-only,
  // same reasoning as `notifications.email.resend.enabled` above.
  {
    key: 'notifications.email.provider',
    description:
      'Which channel delivers outgoing email: RESEND (production) or MAILPIT (local dev only).',
    value: 'RESEND',
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
  // GOS-121 — Mutual Engagement Reviews. TWO independent flags, same
  // "module-wide kill switch" + "a second, more granular flag" pattern
  // `quote-negotiation.general.enabled` +
  // `quote-negotiation.price-edit.*-can-propose` already establish —
  // `reviews.comment.enabled` is checked in ADDITION to
  // `reviews.rating.enabled`, never instead of it. Top-level `reviews.*`
  // (not nested under `customer.*`), same "own top-level capability
  // namespace" convention as `quote-negotiation.*` — this is a distinct
  // capability, not a Customer-only concern (both Customer and Professional
  // submit/receive reviews). `isPublic: false` for both — backend/admin-only
  // gates; `goservice-mobile` just calls `submitEngagementReview` and
  // handles `REVIEWS_MODULE_DISABLED`/`REVIEW_COMMENTS_DISABLED` like any
  // other domain error, same reasoning as every other capability flag above.
  {
    key: 'reviews.rating.enabled',
    description:
      'Global kill switch for the mutual Engagement review capability (submitEngagementReview) — with or without a comment.',
    value: 'true',
    isPublic: false,
  },
  {
    key: 'reviews.comment.enabled',
    description:
      'Controls ONLY the free-text comment field on a review — independent of reviews.rating.enabled. When false, submitEngagementReview still accepts a rating-only call but rejects any non-empty comment with REVIEW_COMMENTS_DISABLED (never silently drops it).',
    value: 'true',
    isPublic: false,
  },
  // GOS-70 — storage / image-processing knobs. Managed from the admin panel
  // by the DEDICATED `updateStorageSettings` mutation (permission
  // `STORAGE_SETTINGS_WRITE`), NOT the generic `setPlatformSetting`, which
  // rejects any `storage.*` key. `isPublic: false` — internal knobs; the
  // mobile app just calls `requestProfilePhotoUploadUrl` and handles
  // `PROFILE_PHOTO_UPLOAD_DISABLED` like any other domain error. Seeded so
  // they show up in the panel with a real value from day one.
  {
    key: 'storage.profile-photo-upload.enabled',
    description:
      'Enables the profile-photo upload flow (requestProfilePhotoUploadUrl + photoUploadRef). Does NOT affect ServiceRequest attachments or the email logo.',
    value: 'true',
    isPublic: false,
  },
  {
    key: 'storage.image-processing.max-dimension-px',
    description:
      'Longest-edge cap (px) applied to every image processed by the shared storage layer. One of 512, 1024, 2048.',
    value: '1024',
    isPublic: false,
    valueType: 'NUMBER',
  },
  {
    key: 'storage.image-processing.webp-quality',
    description:
      'WebP encode quality (1-100) for images processed by the shared storage layer.',
    value: '80',
    isPublic: false,
    valueType: 'NUMBER',
  },
  // GOS-109 — the single, global commission percentage confirmed by
  // DEC-008 (`goservice-docs/decisions/DEC-008-commission-and-cancellation-fee.md`),
  // applied uniformly to a completed job's `CUSTOMER_CHARGE` (GOS-79/80,
  // not yet built) AND to the Customer cancellation-fee amount itself
  // (GOS-109, `RecordCustomerCancellationChargeService`) — DEC-008
  // deliberately reuses ONE number for both rather than a separate
  // `payments.cancellation.customerFeePercent` key. `isPublic: false` —
  // an internal pricing/commission detail, not something `goservice-mobile`
  // needs to branch on. Read via `PlatformSettingPort.getValue`, never
  // cached — a later admin change never rewrites a past `LedgerEntry`'s own
  // frozen `commissionPercentApplied`.
  //
  // Nested under a `general-settings` group (2026-09-14 follow-up,
  // human-requested settings-IA reorganization) — a sibling of
  // `payments.payment-methods.*` (below): a configuration value that
  // applies platform-wide across every payment method, not a per-method
  // on/off switch, so it belongs in its own "General Settings" group rather
  // than piling up next to `payment-methods.cash`/a future
  // `payment-methods.card`. RENAMED from the flatter
  // `payments.commission.percent` — the existing row was renamed in place
  // (same id/value), never re-seeded as a duplicate.
  {
    key: 'payments.general-settings.commission.percent',
    description:
      "GoService's global commission percentage, applied to completed jobs and to the Customer cancellation fee alike (DEC-008).",
    value: '10',
    isPublic: false,
    valueType: 'NUMBER',
  },
  // GOS-87 — Pago en Efectivo: the GLOBAL kill switch for the whole Cash
  // Payment capability (`confirmCashPayment` only —
  // `myPendingCashCommissionDebt` is a read of already-existing data and is
  // NOT gated by this switch, see `CashPaymentModuleEnabledGuard`'s own
  // header comment). `value: 'true'` (default ON) — same "already-working,
  // real MVP payment method, not an experimental opt-in" reasoning
  // `customer.appointments.enabled`'s own comment documents: the point of
  // this switch is letting an admin turn it OFF during an incident, not
  // requiring an opt-in before it works at all. `isPublic: true` (GOS-80
  // follow-up, 2026-09-18 — was `false`): `goservice-mobile` must show/hide
  // the Cash option based on this flag BEFORE the user ever attempts
  // `confirmCashPayment`, so it is exposed via `platformConfig` (as
  // `payments.paymentMethods.cash.enabled`), same as
  // `customer.social-login.*.enabled`. Because this seed only ever
  // `create`s (`update: {}`), existing environments are flipped by the
  // `20260918120000_gos_80_make_cash_enabled_public` data-fixup migration,
  // not by this file. The backend still enforces the switch itself
  // (`CashPaymentModuleEnabledGuard`) regardless of what the client shows.
  //
  // Nested under a `payment-methods` group (2026-09-14 follow-up,
  // human-requested) — a sibling slot for a future `payments.payment-methods.mercadopago.card.*`
  // (GOS-79) to join without piling up flat next to Commission. RENAMED
  // from the flatter `payments.cash.enabled` — the existing row was renamed
  // in place (same id/value), never re-seeded as a duplicate.
  {
    key: 'payments.payment-methods.cash.enabled',
    description:
      'Global kill switch for the Cash Payment capability (confirmCashPayment).',
    value: 'true',
    isPublic: true,
  },
  // Customer-facing display name for the Cash payment method — 2026-09-14
  // follow-up, human-requested: "cash" in a given market may really mean a
  // bundle of local options (e.g. a Nequi transfer or a bank transfer in
  // Colombia, not literal banknotes), so the admin needs to be able to set
  // the actual label shown in the app, rather than a hardcoded "Cash"/
  // "Efectivo" string baked into the mobile client. `isPublic: true` —
  // this is DELIBERATELY exposed via `platformConfig` (as
  // `payments.paymentMethods.cash.displayName`), the same generic,
  // dot-path-driven mechanism `customer.social-login.google.client-id`
  // already establishes for a non-secret, consumer-relevant STRING value —
  // that is the whole point of this field, so `goservice-mobile` can render
  // it instead of a hardcoded label. Default is a plain, generic Spanish
  // label — an admin customizes it further per market (e.g. appending
  // "(Nequi, transferencia)" for Colombia) through this same Settings row;
  // there is NO per-country variant of this key today (matching DEC-008's
  // own "single global value, not split by country" precedent for
  // `payments.general-settings.commission.percent`) — flagged as an open
  // question if a real per-country need ever comes up.
  //
  // NOT itself consumed by `goservice-mobile` as part of this change — same
  // "backend prepares the data, the frontend's own follow-up work decides
  // how to render it" posture already documented for `myPaymentReceipts`.
  {
    key: 'payments.payment-methods.cash.display-name',
    description:
      'Customer-facing display name for the Cash payment method, shown by goservice-mobile (e.g. "Efectivo (Nequi, transferencia)").',
    value: 'Efectivo',
    isPublic: true,
  },
  // GOS-85 — the GLOBAL kill switch for card payments (`payEngagementWithCard`
  // only). `value: 'false'` (default OFF) — the deliberate OPPOSITE of
  // `payments.payment-methods.cash.enabled` above: `PlatformSettingPort.isEnabled`
  // is FAIL-OPEN for a missing row, so "off until certified" only holds
  // because this row is seeded explicitly. Card is off by default because a
  // real end-to-end card charge is not yet certified in production
  // (DEC-009), and because until the Mercado Pago credentials below are
  // configured it could not work anyway. `isPublic: false` — a
  // backend/admin-only gate, same as every other capability flag.
  {
    key: 'payments.payment-methods.mercadopago.card.enabled',
    description:
      'Global kill switch for the Card Payment capability (payEngagementWithCard). Off until the real card flow is certified.',
    value: 'false',
    isPublic: false,
  },
  // GOS-149 — the SAVED-CARDS feature of the Mercado Pago CARD method (a
  // Mercado Pago customer per GoService Customer, a card attached to it the
  // moment a normal card payment opts in to save it via `saveCard: true`,
  // `mySavedCards`, `payEngagementWithSavedCard` with a re-tokenized CVV). A
  // feature OF the Mercado Pago card flow, not a second method — only takes
  // effect while `payments.payment-methods.mercadopago.card.enabled` is ON
  // too. `value: 'false'` for the same fail-open reason as every sibling
  // flag. Independent of Rapyd's own `payments.payment-methods.rapyd.saved-cards-enabled`.
  {
    key: 'payments.payment-methods.mercadopago.card.saved-cards-enabled',
    description:
      'Switch for the saved-cards feature of the Mercado Pago card payment method (save a card while paying, list saved cards, pay with a saved card — CVV re-entry required on every charge). Only effective while payments.payment-methods.mercadopago.card.enabled is ON. Independent of Rapyd. Off until certified with real cards.',
    value: 'false',
    isPublic: false,
  },
  // GOS-142 — the GLOBAL kill switch for wallet (redirect-to-Mercado-Pago-
  // account) payments (`startEngagementWalletPayment` only). `value: 'false'`
  // (default OFF), same reasoning as `payments.payment-methods.mercadopago.card.enabled`
  // above: `PlatformSettingPort.isEnabled` is FAIL-OPEN for a missing row, so
  // "off until certified" only holds because this row is seeded explicitly.
  // Off by default because the wallet flow's redirect/webhook circle has
  // never been completed live (no public HTTPS URL exists in any environment
  // yet — see `payments.general-settings.callbacks.public-base-url` and the
  // `payments.payment-methods.mercadopago.wallet.back-url-*` keys, deliberately NOT seeded
  // with a real value, same precedent as the credential rows below).
  // `isPublic: false` — a backend/admin-only gate, same as Card's.
  {
    key: 'payments.payment-methods.mercadopago.wallet.enabled',
    description:
      'Global kill switch for the Mercado Pago Wallet Payment capability (startEngagementWalletPayment). Off until a public HTTPS URL exists to receive the redirect/webhook.',
    value: 'false',
    isPublic: false,
  },
  // GOS-85 — which Mercado Pago credential set is in use: `sandbox` or
  // `production`. Seeded `sandbox` (the safe default) for EACH country
  // (2026-09-18: a Mercado Pago account belongs to exactly one country's
  // marketplace — one credential pair cannot serve two countries — so this
  // is now independent per country, human-confirmed: one country may go to
  // production while another is still being certified). NOTE the API base
  // URL is the same in both (`https://api.mercadopago.com`) — Mercado Pago
  // tells sandbox from production by the CREDENTIAL used, not by the host —
  // so this value is a deliberate, admin-visible statement of intent (and is
  // logged on every charge), not something that switches an endpoint. The
  // other 3 `payments.payment-methods.mercadopago.<country>.*` keys per country
  // (`access-token`, `webhook-secret` — encrypted; `public-key` — plain,
  // meant to be `isPublic` so the mobile card form can read the RIGHT
  // country's key via `platformConfig`) are real credentials and are NOT
  // seeded, same precedent as the `identity.didit.*` credentials — they are
  // set from the admin panel (`KNOWN_SETTING_SLOTS`).
  {
    key: 'payments.payment-methods.mercadopago.co.environment',
    description:
      'Which Mercado Pago credential set is in use for Colombia: sandbox or production.',
    value: 'sandbox',
    isPublic: false,
  },
  {
    key: 'payments.payment-methods.mercadopago.ar.environment',
    description:
      'Which Mercado Pago credential set is in use for Argentina: sandbox or production.',
    value: 'sandbox',
    isPublic: false,
  },
  // GOS-146 — Rapyd, the SECOND card provider (embedded Checkout Toolkit, no
  // redirect). Selectable independently of Mercado Pago: each provider has its
  // own kill switch and its own per-country credentials, so GoService can
  // operate with one, the other, or both.
  //
  // The GLOBAL kill switch for Rapyd (`startEngagementRapydCheckout` only).
  // `value: 'false'` (default OFF), same reasoning as
  // `payments.payment-methods.mercadopago.card.enabled`: `PlatformSettingPort.isEnabled` is
  // FAIL-OPEN for a missing row, so "off until configured/certified" only holds
  // because this row is seeded explicitly. Deliberately NOT a reinterpretation
  // of `payments.payment-methods.mercadopago.card.enabled` — that key keeps governing ONLY
  // Mercado Pago's card flow. `isPublic: false` — a backend/admin-only gate.
  {
    key: 'payments.payment-methods.rapyd.enabled',
    description:
      'Global kill switch for the Rapyd card payment capability (startEngagementRapydCheckout). Independent of the Mercado Pago switches. Off until Rapyd credentials are configured and the flow is certified.',
    value: 'false',
    isPublic: false,
  },
  // The SAVED-CARDS feature of the Rapyd method (GOS-146): a Rapyd customer per
  // GoService Customer, the "save card" box in the widget, `mySavedCards`,
  // `payEngagementWithSavedCard`. A feature OF Rapyd, not a second method: it
  // only takes effect while `payments.payment-methods.rapyd.enabled` is ON too.
  // `value: 'false'` for the same fail-open reason as the flags above.
  {
    key: 'payments.payment-methods.rapyd.saved-cards-enabled',
    description:
      'Switch for the saved-cards feature of the Rapyd payment method (save a card in the widget, list saved cards, pay with a saved card in one tap). Only effective while payments.payment-methods.rapyd.enabled is ON. Independent of the Mercado Pago switches. Off until certified with real cards.',
    value: 'false',
    isPublic: false,
  },
  // Customer-facing label for the Rapyd option in `availablePaymentMethods`,
  // same idea/style as `payments.payment-methods.cash.display-name`. It is read
  // by the backend and returned by that query, so it need not be `isPublic`.
  {
    key: 'payments.payment-methods.rapyd.display-name',
    description:
      'Customer-facing display name for the Rapyd payment option, returned by availablePaymentMethods (e.g. "Tarjeta").',
    value: 'Tarjeta',
    isPublic: false,
  },
  // Labels for Mercado Pago's two options in the same catalog (GOS-146 asked
  // for a `displayName` per option and "nothing hardcoded"): the card flow
  // (governed by `card.enabled`) and the wallet flow.
  {
    key: 'payments.payment-methods.mercadopago.card.display-name',
    description:
      'Customer-facing display name for the Mercado Pago card payment option, returned by availablePaymentMethods.',
    value: 'Tarjeta de crédito o débito',
    isPublic: false,
  },
  {
    key: 'payments.payment-methods.mercadopago.wallet.display-name',
    description:
      'Customer-facing display name for the Mercado Pago wallet payment option, returned by availablePaymentMethods.',
    value: 'Mercado Pago',
    isPublic: false,
  },
  // Which Rapyd environment the (single) credential set belongs to. ONE Rapyd
  // credential set serves EVERY country — verified live 2026-09-21: the same
  // access/secret key created and completed a Colombia/COP AND an Argentina/ARS
  // payment (a Rapyd account is multi-country, unlike a Mercado Pago one) — so
  // there is one `environment`, not one per country (a key pair belongs to
  // exactly one environment). Seeded `sandbox` (the safe default). UNLIKE
  // Mercado Pago, Rapyd has a different API host and a different Checkout
  // Toolkit script host per environment, so this value really does switch
  // endpoints. `payments.payment-methods.rapyd.access-key` and `payments.payment-methods.rapyd.secret-key`
  // (both ENCRYPTED) are real credentials and are NOT seeded — same precedent
  // as `payments.payment-methods.mercadopago.*` and `identity.didit.*`; the human loads them
  // from the admin panel (`KNOWN_SETTING_SLOTS`). The Rapyd webhook URL reuses
  // the global `payments.general-settings.callbacks.public-base-url` (no second base URL).
  {
    key: 'payments.payment-methods.rapyd.environment',
    description:
      'Which Rapyd environment the credentials belong to (all countries): sandbox or production.',
    value: 'sandbox',
    isPublic: false,
  },
  // How long (minutes) a created Rapyd checkout stays payable. Rapyd cannot
  // cancel a checkout, so a SHORT lifetime is what bounds the window in which a
  // widget the Customer walked away from could still be paid after they
  // abandoned the attempt. Rapyd's own default is 14 days. Invalid/missing →
  // the parameter is omitted and Rapyd's default applies.
  {
    key: 'payments.payment-methods.rapyd.checkout-expiration-minutes',
    description:
      'Minutes a Rapyd checkout stays payable before it expires (1-20160). Short values limit how long an abandoned checkout can still be paid.',
    value: '60',
    valueType: 'NUMBER',
    isPublic: false,
  },
  // GOS-153 — Maps & Discovery. `maps.enabled` is the GLOBAL kill switch for
  // the whole Maps capability (today: Address CRUD — addAddress/
  // updateAddress/deleteAddress/setDefaultAddress/myAddresses; later: the
  // Home Map view). `isPublic: true`: exposed via the unauthenticated
  // `platformConfig` query (as `maps.enabled`) so mobile can decide whether
  // to offer the feature at all, without a mobile deploy — same reasoning as
  // `identity.enabled` above. Also registered in
  // `src/platform-admin/platform-settings/public/known-platform-config-defaults.ts`
  // so that branch is always present even before this seed has run.
  //
  // Seeded OFF (same "off until configured/certified" precedent as
  // `payments.payment-methods.mercadopago.card.enabled`): this backend
  // never calls Google itself (see Address's own header comment in
  // schema.prisma — coordinates arrive already resolved from the mobile
  // app's own Google Places SDK call), but the capability is still gated
  // behind this switch until a human turns it on.
  //
  // `maps.google.api-key` (see `src/addresses/constants/maps-setting-keys.constants.ts`)
  // is a real credential and is deliberately NOT seeded with any value —
  // same precedent as `identity.didit.*`/`payments.payment-methods.mercadopago.*`:
  // a human loads it from the admin panel (`KNOWN_SETTING_SLOTS`) once a
  // server-side Maps usage that actually needs it exists.
  {
    key: 'maps.enabled',
    description:
      'Global kill switch for the Maps capability (Address CRUD, Home Map). Off until maps.google.api-key is configured.',
    value: 'false',
    isPublic: true,
  },
];

// Editable transactional-email templates follow-up (2026-08-24) — seeds the
// 3 fixed `EmailTemplate` rows (`verification_code`/`password_reset_code`/
// `admin_invite`) with a hand-written, email-client-safe default HTML design
// (outer `<table>` layout, every style INLINE via `style="..."`, no
// flexbox/grid/`<style>` blocks, ~600px max-width) — REQUIRED for a fresh
// environment to not be broken: without this, `EmailTemplatePort.getByKey`
// returns `null` and every sender adapter
// (`EmailQueueVerificationCodeSenderAdapter`/
// `EmailQueuePasswordResetEmailSenderAdapter`/
// `EmailQueueAdminInviteEmailSenderAdapter`) fails loudly with
// `EMAIL_TEMPLATE_NOT_CONFIGURED` — same "required seed, not optional
// decoration" precedent `notifications.email.resend.*` already establishes
// above. See `src/platform-admin/email-templates/known-email-template-keys.constant.ts`
// for the single source of truth on which `{{variableName}}` tokens each
// template actually receives, and `src/email/templates/render-email-template.util.ts`
// for how substitution works (HTML-escaped only when rendering into
// `htmlBody`).
//
// Brand colors match `goservice-mobile`'s own design system exactly
// (`goservice-mobile/src/design-system/theme/colors.light.ts`):
// `brand.primary` (#12365E, the wordmark), `brand.primarySurface` (#DDE7F4,
// the code display box background), `action.primary` (#2E6BE6, the
// admin-invite button).
//
// Shared header/footer follow-up (2026-08-25) — the header/footer HTML that
// used to be hand-embedded once per row via the `emailLayout()` helper
// (DELETED — this comment documents its former existence for anyone
// grepping history) now lives as the single seeded `EmailLayout` row below
// (`EMAIL_LAYOUT`), applied automatically to every `EmailTemplate` at
// send-time by `EmailTemplateRenderer`
// (`src/email/templates/email-template-renderer.service.ts`) — NOT
// re-embedded into each `EMAIL_TEMPLATES` entry's `htmlBody` anymore (see
// each entry's own comment below). `headerHtml`/`footerHtml` below are the
// EXACT, unchanged HTML the old helper used to splice around `bodyHtml` —
// relocated, not redesigned.
// Uploadable-logo follow-up (2026-08-25) — the ONE hardcoded, FIXED storage
// key this seed writes the provisional monogram bytes to. Fixed (not
// `randomBytes` per run) so re-seeding is idempotent and never creates
// duplicate files — see `seedEmailLogo()` below. Must match
// `LocalDevStorageAdapter.pathFor`'s own regex
// (`/^[a-f0-9]{32}(\.[a-z]+)?$/`): 32 lowercase hex chars + a `.png`
// extension, generated once via
// `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`
// and pasted here as a constant — never regenerated.
const SEEDED_EMAIL_LOGO_KEY = 'a8f39a588b2aa735f59cd641bad81381.png';

const EMAIL_LAYOUT = {
  headerHtml:
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F6F6F8; padding:24px 0;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#FFFFFF; border-radius:8px; overflow:hidden;">` +
    `<tr><td style="padding:24px 32px; border-bottom:1px solid #F6F6F8;">` +
    // Uploadable-logo follow-up (2026-08-25) — REPLACES the former plain
    // text `<span>GoService</span>` wordmark with an `<img>` referencing
    // the `{{logoUrl}}` token (the SAME `{{variableName}}` substitution
    // mechanism every other layout variable already uses — see
    // `EmailTemplateRenderer`'s own header comment). No other part of this
    // header/footer design changes.
    `<img src="{{logoUrl}}" alt="GoService" style="height:40px; display:block;">` +
    `</td></tr>` +
    `<tr><td style="padding:32px; font-family:Arial, Helvetica, sans-serif; font-size:15px; line-height:1.5; color:#1C2430;">`,
  footerHtml:
    `</td></tr>` +
    `<tr><td style="padding:20px 32px; background-color:#F6F6F8; font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:1.5; color:#8A94A6;">` +
    `Este es un mensaje automático de GoService. Si no esperabas este correo, podés ignorarlo con seguridad.` +
    `</td></tr>` +
    `</table>` +
    `</td></tr>` +
    `</table>`,
  // Today's `textBody` values have NO header/footer at all — every one of
  // them starts directly with `{{greeting}}` — so there is nothing to
  // prepend; an empty string keeps that behavior identical once
  // `EmailTemplateRenderer` starts wrapping every template's text body too.
  headerText: '',
  footerText:
    '\n\n---\nEste es un mensaje automático de GoService. Si no esperabas este correo, podés ignorarlo con seguridad.',
};

/**
 * Uploadable-logo follow-up (2026-08-25) — a ONE-TIME, DELIBERATE seed-time
 * convenience that copies the mobile app's own provisional monogram
 * (`goservice-mobile/assets/branding/monogram-g-provisional.png`, the
 * project's current, explicitly-provisional logo — see that file's own
 * naming) directly into this backend's local upload storage
 * (`var/uploads/`, the SAME directory `LocalDevStorageAdapter.writeFile`
 * already uses), so the "uploadable logo" feature ships with a REAL working
 * logo rather than an empty field.
 *
 * NOT a repeatable pattern — this is the ONLY place this backend ever
 * reaches into `goservice-mobile/` for an asset, and it is NOT something
 * that runs in a real production seed: a real admin uploads their own logo
 * through the admin panel (`requestEmailLogoUploadUrl` +
 * `updateEmailLayout`), exactly like any other content edit. This function
 * exists purely so a FRESH local/e2e environment's `EmailLayout` singleton
 * starts with a working, visible logo instead of a blank one.
 *
 * DEFENSIVE: if the source file is missing (e.g. the `goservice-mobile`
 * submodule/checkout isn't present in whatever environment runs this seed),
 * this logs a warning and returns `null` rather than failing the whole
 * seed — `EMAIL_LAYOUT`'s `{{logoUrl}}` token then just renders as an empty
 * string (see `EmailTemplateRenderer`'s own `?? ''` fallback), never a
 * broken image tag pointing at a 404.
 */
async function seedEmailLogo(): Promise<string | null> {
  const sourcePath = join(
    __dirname,
    '..',
    '..',
    'goservice-mobile',
    'assets',
    'branding',
    'monogram-g-provisional.png',
  );

  if (!existsSync(sourcePath)) {
    console.warn(
      `seed: provisional logo source not found at ${sourcePath} — leaving EmailLayout.logoUrl unset on first seed. (This is expected if goservice-mobile isn't checked out alongside this repo.)`,
    );
    return null;
  }

  try {
    const uploadsDir = join(process.cwd(), 'var', 'uploads');
    await mkdir(uploadsDir, { recursive: true });
    await copyFile(sourcePath, join(uploadsDir, SEEDED_EMAIL_LOGO_KEY));
  } catch (error) {
    console.warn(
      `seed: failed to copy the provisional logo into var/uploads/ — leaving EmailLayout.logoUrl unset on first seed.`,
      error,
    );
    return null;
  }

  const baseUrl = process.env.STORAGE_LOCAL_BASE_URL ?? 'http://localhost:3000';
  return `${baseUrl}/uploads/${SEEDED_EMAIL_LOGO_KEY}`;
}

function codeDisplayBoxHtml(): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">` +
    `<tr><td style="background-color:#DDE7F4; border-radius:6px; padding:16px 24px; font-family:Arial, Helvetica, sans-serif; font-size:32px; font-weight:bold; letter-spacing:6px; color:#12365E;">{{code}}</td></tr>` +
    `</table>`
  );
}

const EMAIL_TEMPLATES: {
  key: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}[] = [
  {
    key: 'verification_code',
    subject: 'Tu código de verificación de GoService',
    // Bare inner body ONLY — no `emailLayout(...)` wrapper anymore (see
    // `EMAIL_LAYOUT`'s own comment above): the shared header/footer is
    // applied automatically at send-time by `EmailTemplateRenderer`, not
    // baked into this row.
    htmlBody:
      `<p style="margin:0 0 16px 0;">{{greeting}}</p>` +
      `<p style="margin:0 0 8px 0;">Tu código de verificación es:</p>` +
      codeDisplayBoxHtml() +
      `<p style="margin:16px 0 0 0;">Vence en {{ttlMinutes}} minutos y es válido para un solo uso. Si no solicitaste este código, podés ignorar este mensaje.</p>`,
    textBody:
      `{{greeting}}\n\n` +
      `Tu código de verificación es: {{code}}\n\n` +
      `Vence en {{ttlMinutes}} minutos y es válido para un solo uso. ` +
      `Si no solicitaste este código, podés ignorar este mensaje.`,
  },
  {
    key: 'password_reset_code',
    subject: 'Tu código para restablecer tu contraseña de GoService',
    // Bare inner body ONLY — see `verification_code`'s own comment above.
    htmlBody:
      `<p style="margin:0 0 16px 0;">{{greeting}}</p>` +
      `<p style="margin:0 0 8px 0;">Tu código para restablecer tu contraseña es:</p>` +
      codeDisplayBoxHtml() +
      `<p style="margin:16px 0 0 0;">Vence en {{ttlMinutes}} minutos y es válido para un solo uso. Si no solicitaste este cambio, podés ignorar este mensaje: tu contraseña actual seguirá funcionando.</p>`,
    textBody:
      `{{greeting}}\n\n` +
      `Tu código para restablecer tu contraseña es: {{code}}\n\n` +
      `Vence en {{ttlMinutes}} minutos y es válido para un solo uso. ` +
      `Si no solicitaste este cambio, podés ignorar este mensaje: tu contraseña actual seguirá funcionando.`,
  },
  {
    key: 'admin_invite',
    subject: 'Fuiste invitado al panel de administración de GoService',
    // Bare inner body ONLY — see `verification_code`'s own comment above.
    htmlBody:
      `<p style="margin:0 0 16px 0;">{{greeting}}</p>` +
      `<p style="margin:0 0 20px 0;">Fuiste invitado como administrador al panel de administración de GoService.</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px; background-color:#2E6BE6;">` +
      `<a href="{{inviteLink}}" style="background:#2E6BE6; color:#ffffff; padding:12px 24px; border-radius:6px; text-decoration:none; display:inline-block; font-family:Arial, Helvetica, sans-serif; font-size:15px; font-weight:bold;">Configurar mi contraseña</a>` +
      `</td></tr></table>` +
      `<p style="margin:20px 0 0 0;">Este enlace vence en {{ttlHours}} horas y solo puede usarse una vez. Si no esperabas esta invitación, podés ignorar este mensaje con seguridad.</p>`,
    textBody:
      `{{greeting}}\n\n` +
      `Fuiste invitado como administrador al panel de administración de GoService.\n\n` +
      `Configurá tu contraseña acá: {{inviteLink}}\n\n` +
      `Este enlace vence en {{ttlHours}} horas y solo puede usarse una vez. ` +
      `Si no esperabas esta invitación, podés ignorar este mensaje con seguridad.`,
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

  for (const template of EMAIL_TEMPLATES) {
    // update: {} — an already-admin-edited template's real content is never
    // clobbered back to this default design by re-running the seed, same
    // idempotent convention as `PLATFORM_SETTINGS` above.
    await prisma.emailTemplate.upsert({
      where: { key: template.key },
      update: {},
      create: {
        key: template.key,
        subject: template.subject,
        htmlBody: template.htmlBody,
        textBody: template.textBody,
      },
    });
  }

  // Shared header/footer follow-up (2026-08-25) — the single `EmailLayout`
  // row (`id: 'singleton'`). `update: {}` — same idempotent-safe-against-
  // admin-edits convention as `EMAIL_TEMPLATES`/`PLATFORM_SETTINGS` above: an
  // already-admin-edited layout is never clobbered back to this default by
  // re-running the seed. `logoUrl` is likewise only ever set on FIRST
  // creation (`create`) — see `seedEmailLogo()`'s own header comment.
  const seededLogoUrl = await seedEmailLogo();
  await prisma.emailLayout.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      headerHtml: EMAIL_LAYOUT.headerHtml,
      footerHtml: EMAIL_LAYOUT.footerHtml,
      headerText: EMAIL_LAYOUT.headerText,
      footerText: EMAIL_LAYOUT.footerText,
      logoUrl: seededLogoUrl,
    },
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
