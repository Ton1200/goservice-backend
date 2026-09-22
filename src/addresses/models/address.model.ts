import { Field, Float, ID, ObjectType } from '@nestjs/graphql';
import { AddressOwnerRole } from './address-owner-role.enum';

/**
 * One saved Address (Customer's or Professional's). `ownerRole` is exposed
 * so a mobile client can tell which profile list an item belongs to when
 * fetching results for a dual-role User; `customerProfileId`/
 * `professionalProfileId` themselves are NOT exposed — the owning
 * relationship is already implicit ("mine"), same convention as
 * `CustomerProfile`/`ProfessionalProfile` not exposing their own `userId`.
 *
 * `latitude`/`longitude` are real, already-resolved coordinates (this
 * backend never calls Google — see `Address`'s own header comment in
 * `schema.prisma`). Exposing precise coordinates here is deliberately safe
 * pre-`Engagement`: unlike a Quote/Engagement counterparty's location (see
 * DEC-005), this is the CALLER's OWN saved Address, never a counterparty's.
 */
@ObjectType()
export class AddressModel {
  @Field(() => ID)
  id!: string;

  @Field(() => AddressOwnerRole)
  ownerRole!: AddressOwnerRole;

  @Field()
  formattedAddress!: string;

  @Field()
  placeId!: string;

  @Field(() => Float)
  latitude!: number;

  @Field(() => Float)
  longitude!: number;

  @Field(() => String, { nullable: true })
  label!: string | null;

  @Field()
  isDefault!: boolean;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
