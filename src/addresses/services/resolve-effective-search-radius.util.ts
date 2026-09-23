import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { invalidSearchRadius } from '../errors/invalid-search-radius.error';
import { mapsSearchMisconfigured } from '../errors/maps-search-misconfigured.error';
import {
  MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY,
  MAPS_SEARCH_MAX_RADIUS_KM_KEY,
} from '../constants/maps-setting-keys.constants';

/**
 * Shared by `FindNearbyProfessionalsService`/`FindNearbyServiceRequestsService`
 * (GOS-155) — resolves the actual radius (in km) a proximity query should
 * use, reading BOTH `maps.search.default-radius-km` and
 * `maps.search.max-radius-km` fresh on every call (never cached, same
 * "an admin can retune it without a deploy" precedent
 * `RecordCashCommissionDebtService` already establishes for
 * `payments.general-settings.commission.percent`).
 *
 * `requestedRadiusKm` (the caller's own optional `radiusKm` GraphQL
 * argument) must be a positive number when given — rejected with
 * `invalidSearchRadius()` otherwise, checked BEFORE either
 * `PlatformSetting` is even read. When omitted, the platform's own default
 * applies.
 *
 * Either `PlatformSetting` missing (unseeded/typo'd key) or unparseable
 * (non-numeric stored value) fails closed with `mapsSearchMisconfigured()`
 * BEFORE any proximity query runs — same "real backend enforcement, clear
 * errors, no silent guessing/defaulting" philosophy
 * `ledgerCommissionMisconfigured()` already establishes.
 *
 * The returned value is ALWAYS clamped to the configured max
 * (`Math.min(effective, max)`) — a caller can narrow its own search radius
 * below the platform default, never widen it past the platform-enforced
 * ceiling.
 */
export async function resolveEffectiveSearchRadiusKm(
  platformSettingPort: PlatformSettingPort,
  requestedRadiusKm?: number,
): Promise<number> {
  if (requestedRadiusKm !== undefined && requestedRadiusKm <= 0) {
    throw invalidSearchRadius();
  }

  const [rawDefault, rawMax] = await Promise.all([
    platformSettingPort.getValue(MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY),
    platformSettingPort.getValue(MAPS_SEARCH_MAX_RADIUS_KM_KEY),
  ]);

  const defaultRadiusKm = rawDefault === null ? NaN : Number(rawDefault);
  const maxRadiusKm = rawMax === null ? NaN : Number(rawMax);
  if (
    rawDefault === null ||
    rawMax === null ||
    Number.isNaN(defaultRadiusKm) ||
    Number.isNaN(maxRadiusKm)
  ) {
    throw mapsSearchMisconfigured();
  }

  const effectiveRadiusKm = requestedRadiusKm ?? defaultRadiusKm;
  return Math.min(effectiveRadiusKm, maxRadiusKm);
}
