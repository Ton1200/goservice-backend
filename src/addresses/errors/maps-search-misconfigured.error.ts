import { DomainException } from '../../common/errors/domain-exception';

const MAPS_SEARCH_MISCONFIGURED_CODE = 'MAPS_SEARCH_MISCONFIGURED';

/**
 * Thrown by `resolveEffectiveSearchRadiusKm` when either
 * `maps.search.default-radius-km` or `maps.search.max-radius-km` is missing
 * (`PlatformSettingPort.getValue` returns `null` — unseeded/typo'd key) or
 * does not parse to a number (`Number(raw)` is `NaN`) — checked BEFORE any
 * proximity query runs. Mirrors `ledgerCommissionMisconfigured()` exactly:
 * a server-misconfiguration condition, fail-closed per this codebase's own
 * philosophy (real backend enforcement, clear errors, no silent
 * guessing/defaulting) rather than falling back to some hardcoded radius.
 */
export function mapsSearchMisconfigured(): DomainException {
  return new DomainException(
    MAPS_SEARCH_MISCONFIGURED_CODE,
    "GoService's proximity search radius is not configured yet — this search cannot run.",
  );
}
