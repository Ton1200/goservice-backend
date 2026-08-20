import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { NearbyProfessional } from './models/nearby-professional.model';
import { NearbyProfessionalsInput } from './models/nearby-professionals-input.model';
import { ListNearbyProfessionalsService } from './services/list-nearby-professionals.service';

/** GraphQL entry point for Proximity Discovery. Thin delivery adapter — no business logic. */
@Resolver()
export class DiscoveryResolver {
  constructor(
    private readonly listNearbyProfessionalsService: ListNearbyProfessionalsService,
  ) {}

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => [NearbyProfessional], {
    description:
      "Professionals near a search centre, ranked by distance and filtered by Category and each Professional's own declared Service Area — Proximity Discovery (ADR 0006 / DEC-005). Every distance is measured between approximate (snapped) positions only, never exact ones.",
  })
  nearbyProfessionals(
    @CurrentUser() userId: string,
    @Args('input') input: NearbyProfessionalsInput,
  ): Promise<NearbyProfessional[]> {
    return this.listNearbyProfessionalsService.listNearbyProfessionals(
      userId,
      input,
    );
  }
}
