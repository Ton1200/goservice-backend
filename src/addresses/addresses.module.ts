import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { AddressesRepository } from './addresses.repository';
import { AddressesResolver } from './addresses.resolver';
import { MapsModuleEnabledGuard } from './guards/maps-module-enabled.guard';
import { AddAddressService } from './services/add-address.service';
import { DeleteAddressService } from './services/delete-address.service';
import { ListMyAddressesService } from './services/list-my-addresses.service';
import { SetDefaultAddressService } from './services/set-default-address.service';
import { UpdateAddressService } from './services/update-address.service';

/**
 * `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
 * need to be imported here explicitly.
 *
 * Imports: `AuthModule` for `SessionGuard` (every operation requires an
 * active session); `ProfilesModule` for `ProfilesRepository`
 * (`findCustomerProfileByUserId`/`findProfessionalProfileByUserId` — how
 * every service here resolves "which profile does the caller mean/own");
 * `PlatformSettingsModule` for `PlatformSettingPort`
 * (`MapsModuleEnabledGuard`'s `maps.enabled` kill switch).
 */
@Module({
  imports: [AuthModule, ProfilesModule, PlatformSettingsModule],
  providers: [
    AddressesResolver,
    AddressesRepository,
    MapsModuleEnabledGuard,
    AddAddressService,
    UpdateAddressService,
    DeleteAddressService,
    SetDefaultAddressService,
    ListMyAddressesService,
  ],
})
export class AddressesModule {}
