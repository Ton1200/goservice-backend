/**
 * GOS-153 — `PlatformSetting` dot-path keys for the Maps capability.
 * `MAPS_ENABLED_KEY` is the GLOBAL kill switch (see
 * `MapsModuleEnabledGuard`), seeded `false` (`prisma/seed.ts`) — off until
 * a real Google Maps/Places API key is configured from the admin panel,
 * same "seeded-off capability switch" precedent as
 * `payments.payment-methods.mercadopago.card.enabled`
 * (`CardPaymentModuleEnabledGuard`).
 *
 * `MAPS_GOOGLE_API_KEY_ANDROID`/`MAPS_GOOGLE_API_KEY_IOS` — TWO separate
 * keys, not one (updated 2026-09-22, confirmed against Google's own current
 * docs at https://developers.google.com/maps/api-security-best-practices):
 * a Google Maps Platform API key's application restriction is mutually
 * exclusive per platform — a key restricted to "Android apps" (package name
 * + SHA-1) cannot also be restricted to "iOS apps" (bundle ID), and vice
 * versa. Since GoService ships one React Native/Expo app for both
 * platforms, this means two independently-restricted keys are structurally
 * required, not a design choice — this resolves the "decisión pendiente"
 * originally left open in GOS-151/GOS-153.
 *
 * Neither key is READ by this backend today — this module never calls
 * Google itself (see `Address`'s own header comment in `schema.prisma`:
 * coordinates arrive already resolved from the mobile app's own Google
 * Places SDK call). Both keys are declared here so a future server-side
 * Maps usage (e.g. Directions/Distance Matrix for `nearbyProfessionals`, a
 * later GOS-36/GOS-155 subtask) has a single, already-known place to read
 * them from, and so the admin panel's `KNOWN_SETTING_SLOTS` can render a
 * slot for each ahead of that need — both are real credentials and are
 * deliberately NOT seeded with any value (same precedent as
 * `identity.didit.*`/`payments.payment-methods.mercadopago.*`: a human
 * loads them from the admin panel).
 */
export const MAPS_ENABLED_KEY = 'maps.enabled';
export const MAPS_GOOGLE_API_KEY_ANDROID = 'maps.google.api-key.android';
export const MAPS_GOOGLE_API_KEY_IOS = 'maps.google.api-key.ios';

/**
 * GOS-155 — `nearbyProfessionals`/`nearbyServiceRequests` proximity search
 * radius configuration, both `NUMBER`-typed `PlatformSetting`s, `isPublic:
 * false` (backend-only tuning, not something `goservice-mobile` needs to
 * branch on). Read together by `resolveEffectiveSearchRadiusKm`
 * (`src/addresses/services/resolve-effective-search-radius.util.ts`), the
 * SAME "inject `PlatformSettingPort`, `Number(raw)`, null/NaN -> fail
 * closed" pattern
 * `RecordCashCommissionDebtService`/`payments.general-settings.commission.percent`
 * already establishes — never cached, so an admin can retune either value
 * without a deploy.
 *
 * `MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY` is used when the caller does not pass
 * an explicit `radiusKm` argument; `MAPS_SEARCH_MAX_RADIUS_KM_KEY` is an
 * absolute ceiling ALWAYS applied on top of either the default or a
 * caller-supplied value (`Math.min(effective, max)`) — a client can narrow
 * its own search radius, never widen it past the platform-enforced max.
 */
export const MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY =
  'maps.search.default-radius-km';
export const MAPS_SEARCH_MAX_RADIUS_KM_KEY = 'maps.search.max-radius-km';
