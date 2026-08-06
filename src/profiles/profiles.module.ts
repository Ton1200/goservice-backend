import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ProfilesRepository } from './profiles.repository';
import { ProfilesResolver } from './profiles.resolver';
import { GetMyCustomerProfileService } from './services/get-my-customer-profile.service';
import { GetMyProfessionalProfileService } from './services/get-my-professional-profile.service';
import { ListCategoriesService } from './services/list-categories.service';
import { UpsertCustomerProfileService } from './services/upsert-customer-profile.service';
import { UpsertProfessionalProfileService } from './services/upsert-professional-profile.service';

// `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
// need to be imported here explicitly — see `prisma.module.ts`.
//
// Imports `AuthModule` for `SessionGuard` (every query/mutation here
// requires an active session — see `profiles.resolver.ts`) and
// `UsersModule` for `UsersRepository`, needed by `ProfilesRepository` to
// atomically transition `User.accountStatus` on the first successful
// `CustomerProfile` creation. Both are the exact same cross-module reuse
// seam `PasswordResetModule` already uses for `AuthModule`/`UsersModule`.
@Module({
  imports: [AuthModule, UsersModule],
  providers: [
    ProfilesResolver,
    ProfilesRepository,
    GetMyCustomerProfileService,
    GetMyProfessionalProfileService,
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
