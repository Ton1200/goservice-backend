import { Coordinates, EARTH_RADIUS_KM } from './haversine.util';

export const LOCATION_GRID_METERS = 500;

const EARTH_RADIUS_METERS = EARTH_RADIUS_KM * 1000;
const METERS_PER_DEGREE_LATITUDE = (Math.PI * EARTH_RADIUS_METERS) / 180;
const DEGREES_PER_LATITUDE_CELL =
  LOCATION_GRID_METERS / METERS_PER_DEGREE_LATITUDE;

const MIN_COS_LATITUDE = 0.01;

/** Snaps a coordinate pair to the ~500 m grid (ADR 0006) — deterministic, not
 * random, so repeated queries can't average out the true point. */
export function snapToGrid(coordinates: Coordinates): Coordinates {
  const snappedLatitude =
    Math.round(coordinates.latitude / DEGREES_PER_LATITUDE_CELL) *
    DEGREES_PER_LATITUDE_CELL;

  const cosLatitude = Math.max(
    MIN_COS_LATITUDE,
    Math.cos((snappedLatitude * Math.PI) / 180),
  );
  const degreesPerLongitudeCell = DEGREES_PER_LATITUDE_CELL / cosLatitude;
  const snappedLongitude =
    Math.round(coordinates.longitude / degreesPerLongitudeCell) *
    degreesPerLongitudeCell;

  return { latitude: snappedLatitude, longitude: snappedLongitude };
}
