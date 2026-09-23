import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { ReviewsRepository } from '../reviews/reviews.repository';
import { UsersModule } from '../users/users.module';
import { CustomerProfileFieldResolver } from './customer-profile-field.resolver';
import { ProfessionalProfileFieldResolver } from './professional-profile-field.resolver';
import { ProfilesRepository } from './profiles.repository';
import { ProfilesResolver } from './profiles.resolver';
import { GetMyAccountService } from './services/get-my-account.service';
import { GetMyCustomerProfileService } from './services/get-my-customer-profile.service';
import { GetMyProfessionalProfileService } from './services/get-my-professional-profile.service';
import { ListCategoriesService } from './services/list-categories.service';
import { RequestProfilePhotoUploadUrlService } from './services/request-profile-photo-upload-url.service';
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
@Module({
  // `PlatformSettingsModule` (resolver-free — see its header) provides
  // `PlatformSettingPort`, which the upsert services and
  // `RequestProfilePhotoUploadUrlService` read for the GOS-70
  // `storage.profile-photo-upload.enabled` toggle. `StoragePort` and the
  // image-processing queue come from the `@Global()` `StorageModule`.
  imports: [AuthModule, UsersModule, PlatformSettingsModule],
  providers: [
    ProfilesResolver,
    ProfilesRepository,
    GetMyAccountService,
    GetMyCustomerProfileService,
    GetMyProfessionalProfileService,
    ListCategoriesService,
    RequestProfilePhotoUploadUrlService,
    UpsertCustomerProfileService,
    UpsertProfessionalProfileService,
    // GOS-121 — `ProfessionalProfile.averageRating`/`.reviewCount`, plus the
    // `CustomerProfile` mirror (human-requested follow-up, same ship).
    // `ReviewsRepository` is reused here as a CONCRETE provider class (same
    // "never import the resolver-bearing Module" pattern this codebase
    // already establishes) — `ProfilesModule` never imports `ReviewsModule`
    // itself, avoiding a cycle (`ReviewsModule` imports `ProfilesModule`).
    ReviewsRepository,
    ProfessionalProfileFieldResolver,
    CustomerProfileFieldResolver,
  ],
  // Forward-looking seam for future modules (ServiceRequest belongs to
  // CustomerProfile, Quote belongs to ProfessionalProfile) that will need
  // to resolve a profile by userId — same pattern as `UsersModule`
  // exporting `UsersRepository`. No consumer exists yet.
  //
  // GOS-155 — `Query.nearbyProfessionals` (`FindNearbyProfessionalsService`,
  // `src/profiles/services/find-nearby-professionals.service.ts`) is
  // DELIBERATELY NOT wired here, even though it reads/returns
  // `ProfessionalProfile` data: it requires `AccountApprovedGuard`
  // (`IdentityVerificationModule`), and `IdentityVerificationModule` itself
  // imports `ProfilesModule` — importing it back here would create the
  // exact cycle `ReviewsRepository`'s own comment above already documents
  // avoiding for `ReviewsModule`. Its resolver method instead lives on
  // `ServiceRequestsResolver`/is wired in `ServiceRequestsModule` (which
  // already imports both `IdentityVerificationModule` and `ProfilesModule`
  // cleanly), reusing `ProfilesRepository` as the exported concrete class
  // below — same cross-module reuse convention this codebase uses
  // throughout.
  exports: [ProfilesRepository],
})
export class ProfilesModule {}
