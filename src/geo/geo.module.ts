import { Module } from '@nestjs/common';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { FakeGeocodingAdapter } from './adapters/fake-geocoding.adapter';
import { GoogleGeocodingAdapter } from './adapters/google-geocoding.adapter';
import { GeocodingPort } from './ports/geocoding.port';

/** Shared geo primitives for Proximity Discovery — exports `GeocodingPort`, bound to `GoogleGeocodingAdapter`. */
@Module({
  imports: [PlatformSettingsModule],
  providers: [
    GoogleGeocodingAdapter,
    FakeGeocodingAdapter,
    { provide: GeocodingPort, useExisting: GoogleGeocodingAdapter },
  ],
  exports: [GeocodingPort],
})
export class GeoModule {}
