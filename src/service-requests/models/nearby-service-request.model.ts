import { Field, Float, ObjectType } from '@nestjs/graphql';
import { AddressModel } from '../../addresses/models/address.model';
import { ServiceRequestModel } from './service-request.model';

/**
 * GOS-155 — one row of `Query.nearbyServiceRequests`: an OPEN
 * `ServiceRequest` whose own `Address` (the one it was published against)
 * currently falls within the requesting Professional's search radius, PLUS
 * that Address itself and the computed distance. Deliberately a WRAPPER
 * type, not a field on `ServiceRequestModel` itself — same reasoning as
 * `NearbyProfessional`'s own header comment: exposing full `Address` here
 * must stay confined to a result that already passed the owning Customer's
 * `locationSharingEnabled` + radius + Maps-enabled gate, never reachable
 * from `ServiceRequestModel`'s base type (e.g. via `compatibleServiceRequests`,
 * which exposes no location data at all — see that model's own header
 * comment).
 */
@ObjectType()
export class NearbyServiceRequest {
  @Field(() => ServiceRequestModel)
  serviceRequest!: ServiceRequestModel;

  @Field(() => AddressModel)
  address!: AddressModel;

  @Field(() => Float)
  distanceKm!: number;
}
