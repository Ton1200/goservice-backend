import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeoModule } from '../geo/geo.module';
import { UsersModule } from '../users/users.module';
import { ProfilesRepository } from './profiles.repository';
import { ProfilesResolver } from './profiles.resolver';
import { GetMyAccountService } from './services/get-my-account.service';
import { GetMyCustomerProfileService } from './services/get-my-customer-profile.service';
import { GetMyProfessionalProfileService } from './services/get-my-professional-profile.service';
import { GetMyServiceAreaService } from './services/get-my-service-area.service';
import { ListCategoriesService } from './services/list-categories.service';
import { UpsertCustomerProfileService } from './services/upsert-customer-profile.service';
import { UpsertProfessionalProfileService } from './services/upsert-professional-profile.service';

// `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
// need to be imported here explicitly — see `prisma.module.ts`.
//
// Imports `AuthModule` for `SessionGuard` (every query/mutation here
// requires an active session — see `profiles.resolver.ts`) and
// `UsersModule` for `UsersRepository`, needed both by `ProfilesRepository`
// (to atomically transition `User.accountStatus` on the first successful
// `CustomerProfile` OR `ProfessionalProfile` creation, whichever comes
// first) and by `GetMyAccountService` (`myAccount`'s own direct read of
// `User.accountStatus`). Both imports are the exact same cross-module reuse
// seam `PasswordResetModule` already uses for `AuthModule`/`UsersModule`.
//
// `GeoModule` for `GeocodingPort`, used by `UpsertCustomerProfileService` to geocode addresses.
@Module({
  imports: [AuthModule, UsersModule, GeoModule],
  providers: [
    ProfilesResolver,
    ProfilesRepository,
    GetMyAccountService,
    GetMyCustomerProfileService,
    GetMyProfessionalProfileService,
    GetMyServiceAreaService,
    ListCategoriesService,
    UpsertCustomerProfileService,
    UpsertProfessionalProfileService,
  ],
  // Forward-looking seam for future modules (ServiceRequest belongs to
  // CustomerProfile, Quote belongs to ProfessionalProfile) that will need
  // to resolve a profile by userId — same pattern as `UsersModule`
  // exporting `UsersRepository`. No consumer exists yet.
  exports: [ProfilesRepository],
})
export class ProfilesModule {}
