import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { DocumentUploadUrlModel } from '../service-requests/models/document-upload-url.model';
import { Category } from './models/category.model';
import { CustomerProfile } from './models/customer-profile.model';
import { MyAccount } from './models/my-account.model';
import { ProfessionalProfile } from './models/professional-profile.model';
import { RequestProfilePhotoUploadUrlInput } from './models/request-profile-photo-upload-url-input.model';
import { UpsertCustomerProfileInput } from './models/upsert-customer-profile-input.model';
import { UpsertProfessionalProfileInput } from './models/upsert-professional-profile-input.model';
import { GetMyAccountService } from './services/get-my-account.service';
import { GetMyCustomerProfileService } from './services/get-my-customer-profile.service';
import { GetMyProfessionalProfileService } from './services/get-my-professional-profile.service';
import { ListCategoriesService } from './services/list-categories.service';
import { RequestProfilePhotoUploadUrlService } from './services/request-profile-photo-upload-url.service';
import { UpsertCustomerProfileService } from './services/upsert-customer-profile.service';
import { UpsertProfessionalProfileService } from './services/upsert-professional-profile.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `UsersResolver`/`AuthResolver`. Every method requires an active session
 * (`@UseGuards(SessionGuard)` + `@CurrentUser()`, exact pattern from
 * `AuthResolver.me`) — including `categories`, since this story carves out
 * no public/unauthenticated exception. The authenticated `userId` always
 * comes from the session, never from any input field.
 */
@Resolver()
export class ProfilesResolver {
  constructor(
    private readonly getMyAccountService: GetMyAccountService,
    private readonly getMyCustomerProfileService: GetMyCustomerProfileService,
    private readonly getMyProfessionalProfileService: GetMyProfessionalProfileService,
    private readonly listCategoriesService: ListCategoriesService,
    private readonly upsertCustomerProfileService: UpsertCustomerProfileService,
    private readonly upsertProfessionalProfileService: UpsertProfessionalProfileService,
    private readonly requestProfilePhotoUploadUrlService: RequestProfilePhotoUploadUrlService,
  ) {}

  @UseGuards(SessionGuard)
  @Query(() => MyAccount, {
    description:
      "The authenticated user's own account-level state (currently just accountStatus).",
  })
  myAccount(@CurrentUser() userId: string): Promise<MyAccount> {
    return this.getMyAccountService.getMyAccount(userId);
  }

  @UseGuards(SessionGuard)
  @Query(() => CustomerProfile, {
    nullable: true,
    description:
      "The authenticated user's CustomerProfile, or null if they haven't created one yet.",
  })
  myCustomerProfile(
    @CurrentUser() userId: string,
  ): Promise<CustomerProfile | null> {
    return this.getMyCustomerProfileService.getMyCustomerProfile(userId);
  }

  @UseGuards(SessionGuard)
  @Query(() => ProfessionalProfile, {
    nullable: true,
    description:
      "The authenticated user's ProfessionalProfile, or null if they haven't created one yet.",
  })
  myProfessionalProfile(
    @CurrentUser() userId: string,
  ): Promise<ProfessionalProfile | null> {
    return this.getMyProfessionalProfileService.getMyProfessionalProfile(
      userId,
    );
  }

  @UseGuards(SessionGuard)
  @Query(() => [Category], {
    description:
      'The full service category catalog, flat and tree-pre-ordered (every parent immediately followed by its own children). Read-only from this schema — managed exclusively from the admin panel (src/platform-admin/categories/), originally seeded via `npm run prisma:seed`.',
  })
  categories(): Promise<Category[]> {
    return this.listCategoriesService.listCategories();
  }

  @UseGuards(SessionGuard)
  @Mutation(() => CustomerProfile, {
    description:
      "Creates or updates the authenticated user's CustomerProfile (idempotent — always exactly one per user). On the first successful creation only, transitions the account's status from EMAIL_VERIFIED to PENDING_APPROVAL.",
  })
  upsertCustomerProfile(
    @CurrentUser() userId: string,
    @Args('input') input: UpsertCustomerProfileInput,
  ): Promise<CustomerProfile> {
    return this.upsertCustomerProfileService.upsertCustomerProfile(
      userId,
      input,
    );
  }

  @UseGuards(SessionGuard)
  @Mutation(() => ProfessionalProfile, {
    description:
      "Creates or updates the authenticated user's ProfessionalProfile (idempotent — always exactly one per user). verificationStatus is always UNVERIFIED on creation and cannot be set from this mutation. specializations fully replaces the professional's set of trades — exactly one must have role PRIMARY. On the first successful creation only, transitions the account's status from EMAIL_VERIFIED to PENDING_APPROVAL.",
  })
  upsertProfessionalProfile(
    @CurrentUser() userId: string,
    @Args('input') input: UpsertProfessionalProfileInput,
  ): Promise<ProfessionalProfile> {
    return this.upsertProfessionalProfileService.upsertProfessionalProfile(
      userId,
      input,
    );
  }

  @UseGuards(SessionGuard)
  @Mutation(() => DocumentUploadUrlModel, {
    description:
      'Issues a short-lived signed URL to upload a profile photo. The client PUTs the raw image bytes to `uploadUrl` (any common image format; the server resizes and re-encodes them to WebP), then passes the returned `ref` as `photoUploadRef` on `upsertCustomerProfile`/`upsertProfessionalProfile` to attach it. Fails with PROFILE_PHOTO_UPLOAD_DISABLED when the feature is turned off in the admin panel.',
  })
  requestProfilePhotoUploadUrl(
    @CurrentUser() userId: string,
    @Args('input') input: RequestProfilePhotoUploadUrlInput,
  ): Promise<DocumentUploadUrlModel> {
    return this.requestProfilePhotoUploadUrlService.requestUploadUrl(
      userId,
      input,
    );
  }
}
