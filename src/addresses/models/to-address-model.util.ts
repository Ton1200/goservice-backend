import { Address } from '@prisma/client';
import { AddressModel } from './address.model';

/**
 * Maps an `Address` row onto its public GraphQL shape — deliberately
 * excludes `customerProfileId`/`professionalProfileId` (the owning
 * relationship is always implicit "mine", never exposed — see
 * `AddressModel`'s own header comment).
 */
export function toAddressModel(address: Address): AddressModel {
  const model = new AddressModel();
  model.id = address.id;
  model.ownerRole = address.ownerRole;
  model.formattedAddress = address.formattedAddress;
  model.placeId = address.placeId;
  model.latitude = address.latitude;
  model.longitude = address.longitude;
  model.label = address.label;
  model.isDefault = address.isDefault;
  model.createdAt = address.createdAt;
  model.updatedAt = address.updatedAt;
  return model;
}
