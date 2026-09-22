import { Field, Float, ObjectType } from '@nestjs/graphql';
import { AddressModel } from '../../addresses/models/address.model';
import { ProfessionalProfile } from './professional-profile.model';

/**
 * GOS-155 — one row of `Query.nearbyProfessionals`: a Professional whose
 * own `isDefault` Address (`AddressOwnerRole.PROFESSIONAL`) currently falls
 * within the requested search radius, PLUS that Address itself and the
 * computed distance. Deliberately a WRAPPER type, not a `@ResolveField` on
 * `ProfessionalProfile` itself — see this ticket's own privacy note:
 * exposing full `Address` (`formattedAddress`/precise `latitude`/
 * `longitude`) must stay confined to a result that already passed the
 * `locationSharingEnabled` + radius + Maps-enabled gate this query itself
 * enforces, never reachable from `ProfessionalProfile`'s base type (e.g. via
 * `compatibleServiceRequests`'s nested professional data) where none of
 * those gates apply.
 */
@ObjectType()
export class NearbyProfessional {
  @Field(() => ProfessionalProfile)
  professional!: ProfessionalProfile;

  @Field(() => AddressModel)
  address!: AddressModel;

  @Field(() => Float)
  distanceKm!: number;
}
