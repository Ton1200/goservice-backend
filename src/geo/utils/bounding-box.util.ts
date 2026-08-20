import { Coordinates, EARTH_RADIUS_KM } from './haversine.util';

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const MIN_COS_LATITUDE = 0.01;

/** Rectangular prefilter around `center` big enough to fully contain every point within `radiusKm` — used as a cheap, indexed Postgres prefilter before exact haversine filtering. */
export function boundingBoxForRadius(
  center: Coordinates,
  radiusKm: number,
): BoundingBox {
  const latDeltaDeg = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);

  const cosLatitude = Math.max(
    MIN_COS_LATITUDE,
    Math.cos((center.latitude * Math.PI) / 180),
  );
  const lngDeltaDeg = latDeltaDeg / cosLatitude;

  return {
    minLat: Math.max(-90, center.latitude - latDeltaDeg),
    maxLat: Math.min(90, center.latitude + latDeltaDeg),
    minLng: center.longitude - lngDeltaDeg,
    maxLng: center.longitude + lngDeltaDeg,
  };
}
