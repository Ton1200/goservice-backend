export interface Coordinates {
  latitude: number;
  longitude: number;
}

export const EARTH_RADIUS_KM = 6371;

/** Great-circle distance (km) between two coordinate pairs, via the haversine formula. */
export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

  const deltaLatRad = toRadians(b.latitude - a.latitude);
  const deltaLngRad = toRadians(b.longitude - a.longitude);
  const latARad = toRadians(a.latitude);
  const latBRad = toRadians(b.latitude);

  const sinHalfDeltaLat = Math.sin(deltaLatRad / 2);
  const sinHalfDeltaLng = Math.sin(deltaLngRad / 2);

  const h =
    sinHalfDeltaLat * sinHalfDeltaLat +
    Math.cos(latARad) * Math.cos(latBRad) * sinHalfDeltaLng * sinHalfDeltaLng;

  const centralAngleRad = 2 * Math.asin(Math.min(1, Math.sqrt(h)));

  return EARTH_RADIUS_KM * centralAngleRad;
}
