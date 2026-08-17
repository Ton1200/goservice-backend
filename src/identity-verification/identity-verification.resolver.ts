import { UseGuards } from '@nestjs/common';
import { Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { IdentityVerificationModel } from './models/identity-verification.model';
import { GetMyIdentityVerificationStatusService } from './services/get-my-identity-verification-status.service';
import { StartIdentityVerificationService } from './services/start-identity-verification.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `ProfilesResolver`/`UsersResolver`. `startIdentityVerification` takes NO
 * input: `country` is resolved entirely server-side inside
 * `StartIdentityVerificationService` — see that class's own header comment
 * for why this is structurally, not just conventionally, enforced (there is
 * no field on this operation for a client to even attempt to set it).
 */
@Resolver()
export class IdentityVerificationResolver {
  constructor(
    private readonly startIdentityVerificationService: StartIdentityVerificationService,
    private readonly getMyIdentityVerificationStatusService: GetMyIdentityVerificationStatusService,
  ) {}

  @UseGuards(SessionGuard)
  @Mutation(() => IdentityVerificationModel, {
    description:
      "Starts a new hosted identity-verification session for the authenticated user. country is always resolved server-side from the caller's own CustomerProfile/ProfessionalProfile — this mutation takes no input. Requires the account to currently be PENDING_APPROVAL.",
  })
  startIdentityVerification(
    @CurrentUser() userId: string,
  ): Promise<IdentityVerificationModel> {
    return this.startIdentityVerificationService.startIdentityVerification(
      userId,
    );
  }

  @UseGuards(SessionGuard)
  @Query(() => IdentityVerificationModel, {
    nullable: true,
    description:
      "The authenticated user's most recent identity-verification attempt, or null if they have never started one. Lets a client poll for the outcome while waiting for the provider's webhook to land.",
  })
  myIdentityVerificationStatus(
    @CurrentUser() userId: string,
  ): Promise<IdentityVerificationModel | null> {
    return this.getMyIdentityVerificationStatusService.getMyIdentityVerificationStatus(
      userId,
    );
  }
}
