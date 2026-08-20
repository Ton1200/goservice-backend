import { Injectable, Logger } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { MAPS_PLATFORM_SETTING_KEYS } from '../constants/maps-settings.constants';
import { GeocodingPort } from '../ports/geocoding.port';
import { Coordinates } from '../utils/haversine.util';

const GOOGLE_GEOCODING_URL =
  'https://maps.googleapis.com/maps/api/geocode/json';

interface GoogleGeocodingLocation {
  lat?: unknown;
  lng?: unknown;
}
interface GoogleGeocodingResult {
  geometry?: { location?: GoogleGeocodingLocation };
}
interface GoogleGeocodingResponse {
  status?: unknown;
  results?: GoogleGeocodingResult[];
}

/** Production `GeocodingPort` implementation — calls the real Google Geocoding API. Never throws; every failure resolves to `null`. */
@Injectable()
export class GoogleGeocodingAdapter implements GeocodingPort {
  private readonly logger = new Logger(GoogleGeocodingAdapter.name);

  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async geocode(address: string): Promise<Coordinates | null> {
    const [rawEnabled, apiKey] = await Promise.all([
      this.platformSettingPort.getValue(MAPS_PLATFORM_SETTING_KEYS.enabled),
      this.platformSettingPort.getValue(
        MAPS_PLATFORM_SETTING_KEYS.geocodingApiKey,
      ),
    ]);

    if (rawEnabled !== 'true') {
      this.logger.warn({ event: 'geocoding_skipped', reason: 'disabled' });
      return null;
    }
    if (!apiKey) {
      this.logger.warn({
        event: 'geocoding_skipped',
        reason: 'misconfigured',
      });
      return null;
    }

    const url = new URL(GOOGLE_GEOCODING_URL);
    url.searchParams.set('address', address);
    url.searchParams.set('key', apiKey);

    let response: Response;
    try {
      response = await fetch(url.toString());
    } catch {
      this.logger.warn({
        event: 'geocoding_failed',
        reason: 'network_error',
      });
      return null;
    }

    if (!response.ok) {
      this.logger.warn({
        event: 'geocoding_failed',
        reason: 'non_2xx_response',
        statusCode: response.status,
      });
      return null;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      this.logger.warn({
        event: 'geocoding_failed',
        reason: 'unparsable_response_body',
      });
      return null;
    }

    return this.extractCoordinates(body);
  }

  private extractCoordinates(rawBody: unknown): Coordinates | null {
    const body = this.asGoogleGeocodingResponse(rawBody);

    if (body.status !== 'OK') {
      this.logger.warn({ event: 'geocoding_no_match', status: body.status });
      return null;
    }

    const location = body.results?.[0]?.geometry?.location;
    if (
      typeof location?.lat !== 'number' ||
      typeof location?.lng !== 'number'
    ) {
      this.logger.warn({
        event: 'geocoding_failed',
        reason: 'missing_expected_fields',
      });
      return null;
    }

    return { latitude: location.lat, longitude: location.lng };
  }

  private asGoogleGeocodingResponse(rawBody: unknown): GoogleGeocodingResponse {
    return typeof rawBody === 'object' && rawBody !== null ? rawBody : {};
  }
}
