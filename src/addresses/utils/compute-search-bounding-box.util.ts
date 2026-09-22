/**
 * GOS-155 — a cheap latitude/longitude bounding box AROUND the search
 * origin, used by `ProfilesRepository.findNearbyProfessionals`/
 * `ServiceRequestsRepository.findNearbyCompatible` as a raw-SQL `WHERE`
 * pre-filter (sargable against `Address`'s own `@@index([latitude,
 * longitude])`) BEFORE the exact — but not indexable — Haversine distance
 * expression narrows the result further. This is the standard
 * "bounding-box pre-filter, exact-distance final filter" technique for
 * doing proximity search without a dedicated geospatial extension.
 *
 * Deliberately NOT PostGIS/the Postgres `earthdistance`/`cube` extensions —
 * see `goservice-docs/architecture/performance.md` for the tradeoff this
 * was weighed against: a raw-SQL Haversine formula needs no extra
 * extension enabled in any environment, at the cost of being a coarser
 * spherical approximation and not usable as a true `ORDER BY <index>
 * LIMIT` (this codebase's Postgres has neither PostGIS nor `earthdistance`
 * installed anywhere).
 *
 * 111.045 km is the approximate length of one degree of latitude (WGS84
 * mean); one degree of longitude shrinks by `cos(latitude)` as latitude
 * moves away from the equator — the deliberately generous approximation
 * used here (Argentina/Colombia's latitudes are all comfortably below the
 * poles where this formula would degrade). The box is intentionally a bit
 * LARGER than the true circle it bounds (a bounding SQUARE always contains
 * the bounding CIRCLE) — the final exact Haversine `WHERE distanceKm <=
 * radiusKm` filter is what actually enforces the real boundary; this
 * function only exists to let Postgres use the lat/lng index instead of a
 * full table scan.
 */
export interface SearchBoundingBox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

const KM_PER_DEGREE_LATITUDE = 111.045;

export function computeSearchBoundingBox(
  latitude: number,
  longitude: number,
  radiusKm: number,
): SearchBoundingBox {
  const latDeltaDegrees = radiusKm / KM_PER_DEGREE_LATITUDE;
  const lngDeltaDegrees =
    radiusKm / (KM_PER_DEGREE_LATITUDE * Math.cos((latitude * Math.PI) / 180));

  return {
    latMin: latitude - latDeltaDegrees,
    latMax: latitude + latDeltaDegrees,
    lngMin: longitude - Math.abs(lngDeltaDegrees),
    lngMax: longitude + Math.abs(lngDeltaDegrees),
  };
}
