import { Coordinates } from '../utils/haversine.util';

/** Turns a postal address into coordinates. Returns `null` (never throws) when the address can't be resolved. */
export abstract class GeocodingPort {
  abstract geocode(address: string): Promise<Coordinates | null>;
}
