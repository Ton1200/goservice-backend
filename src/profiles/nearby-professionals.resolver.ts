import { UseGuards } from '@nestjs/common';
import { Args, Float, ID, Query, Resolver } from '@nestjs/graphql';
import { MapsModuleEnabledGuard } from '../addresses/guards/maps-module-enabled.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { NearbyProfessional } from './models/nearby-professional.model';
import { FindNearbyProfessionalsService } from './services/find-nearby-professionals.service';

/**
 * GOS-155 — `Query.nearbyProfessionals`, a thin delivery adapter (no
 * business logic here, same pattern as every other resolver in this
 * codebase). Deliberately NOT part of `ProfilesResolver`/`ProfilesModule` —
 * see `ProfilesModule`'s own header comment for the module-cycle reason
 * (`AccountApprovedGuard` requires `IdentityVerificationModule`, which
 * itself imports `ProfilesModule`) — this resolver is instead wired as a
 * provider of `ServiceRequestsModule` (see that module's own header
 * comment), which already imports both `IdentityVerificationModule` and
 * `ProfilesModule` cleanly.
 *
 * Guards, in order: `SessionGuard` (active session), `AccountApprovedGuard`
 * (identity-verified account), `MapsModuleEnabledGuard` (the same `maps.enabled`
 * global kill switch every other Maps capability is gated behind — see that
 * guard's own header comment).
 */
@Resolver()
export class NearbyProfessionalsResolver {
  constructor(
    private readonly findNearbyProfessionalsService: FindNearbyProfessionalsService,
  ) {}

  @UseGuards(SessionGuard, AccountApprovedGuard, MapsModuleEnabledGuard)
  @Query(() => [NearbyProfessional], {
    description:
      'Professionals who have opted into location sharing and have a saved default Address currently within radiusKm of (latitude, longitude) — nearest first. categoryId is optional: when given, only Professionals offering it (or one of its ancestor Categories) match; when omitted, every nearby Professional with at least one specialization matches ("ver todos" mode — browse first, filter by category afterwards). radiusKm is optional (defaults to the platform\'s own configured default, always capped at the platform\'s own configured max). A Professional with no saved Address, or with zero specializations, never appears here regardless of location-sharing consent.',
  })
  nearbyProfessionals(
    @Args('categoryId', { type: () => ID, nullable: true })
    categoryId: string | undefined,
    @Args('latitude', { type: () => Float }) latitude: number,
    @Args('longitude', { type: () => Float }) longitude: number,
    @Args('radiusKm', { type: () => Float, nullable: true })
    radiusKm?: number,
  ): Promise<NearbyProfessional[]> {
    return this.findNearbyProfessionalsService.findNearbyProfessionals({
      categoryId,
      latitude,
      longitude,
      radiusKm,
    });
  }
}
