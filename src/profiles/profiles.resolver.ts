import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { Category } from './models/category.model';
import { CustomerProfile } from './models/customer-profile.model';
import { ProfessionalProfile } from './models/professional-profile.model';
import { UpsertCustomerProfileInput } from './models/upsert-customer-profile-input.model';
import { UpsertProfessionalProfileInput } from './models/upsert-professional-profile-input.model';
import { GetMyCustomerProfileService } from './services/get-my-customer-profile.service';
import { GetMyProfessionalProfileService } from './services/get-my-professional-profile.service';
import { ListCategoriesService } from './services/list-categories.service';
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
    private readonly getMyCustomerProfileService: GetMyCustomerProfileService,
    private readonly getMyProfessionalProfileService: GetMyProfessionalProfileService,
    private readonly listCategoriesService: ListCategoriesService,
    private readonly upsertCustomerProfileService: UpsertCustomerProfileService,
    private readonly upsertProfessionalProfileService: UpsertProfessionalProfileService,
  ) {}

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
      'The full read-only service category catalog. No CRUD — seeded via `npm run prisma:seed`.',
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
      "Creates or updates the authenticated user's ProfessionalProfile (idempotent — always exactly one per user). verificationStatus is always UNVERIFIED on creation and cannot be set from this mutation. specializations fully replaces the professional's set of trades — exactly one must have role PRIMARY.",
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
}
