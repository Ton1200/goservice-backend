import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { GeocodingPort } from '../ports/geocoding.port';
import { Coordinates } from '../utils/haversine.util';

const CABA_CENTER_LATITUDE = -34.6037;
const CABA_CENTER_LONGITUDE = -58.3816;
const SPREAD_DEGREES = 0.05;

/** LOCAL DEV/TEST ONLY `GeocodingPort` implementation — deterministically derives coordinates from the address, no network call. */
@Injectable()
export class FakeGeocodingAdapter implements GeocodingPort {
  geocode(address: string): Promise<Coordinates | null> {
    const normalized = address.trim();
    if (normalized.length === 0) {
      return Promise.resolve(null);
    }

    const digest = createHash('sha256')
      .update(normalized.toLowerCase())
      .digest('hex');
    const latitudeOffset = this.unitOffsetFromHex(digest.slice(0, 16));
    const longitudeOffset = this.unitOffsetFromHex(digest.slice(16, 32));

    return Promise.resolve({
      latitude: CABA_CENTER_LATITUDE + latitudeOffset * SPREAD_DEGREES,
      longitude: CABA_CENTER_LONGITUDE + longitudeOffset * SPREAD_DEGREES,
    });
  }

  /** Maps a 16-hex-character chunk of a hash to a value in [-1, 1], evenly. */
  private unitOffsetFromHex(hexChunk: string): number {
    const asInt = BigInt(`0x${hexChunk}`);
    const max = BigInt(`0x${'f'.repeat(hexChunk.length)}`);
    const unitInterval = Number(asInt) / Number(max);
    return unitInterval * 2 - 1;
  }
}
