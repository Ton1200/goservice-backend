import { DomainException } from '../../common/errors/domain-exception';

const INVALID_SEARCH_RADIUS_CODE = 'INVALID_SEARCH_RADIUS';

/**
 * Thrown by `resolveEffectiveSearchRadiusKm` when the caller passes an
 * explicit `radiusKm` argument that is not a positive number
 * (`nearbyProfessionals`/`nearbyServiceRequests` both accept an optional
 * `radiusKm: Float`, with no `@nestjs/graphql` scalar-argument decorator
 * seam to validate it at — see `PublishServiceRequestInput`'s own header
 * comment for why plain scalar `@Args()` in this codebase validate in the
 * application layer, same as the `limit`/`offset` clamping convention every
 * admin list service already establishes).
 */
export function invalidSearchRadius(): DomainException {
  return new DomainException(
    INVALID_SEARCH_RADIUS_CODE,
    'radiusKm must be greater than 0.',
  );
}
