import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { CountryCode } from './country-code.enum';

/**
 * A client's profile — GOS-14/GOS-28. `userId` is deliberately NOT exposed
 * here: `myCustomerProfile` is always implicitly "mine" via
 * `@CurrentUser()`, and nothing in this story needs the raw FK
 * client-side. Adding it later is a purely additive, non-breaking field.
 *
 * `firstName`/`lastName` are the person's real name (nombre / apellido),
 * split out of the former single `displayName` field.
 */
@ObjectType()
export class CustomerProfile {
  @Field(() => ID)
  id!: string;

  @Field()
  firstName!: string;

  @Field()
  lastName!: string;

  @Field()
  addressLine!: string;

  @Field()
  city!: string;

  @Field()
  province!: string;

  @Field(() => CountryCode)
  country!: CountryCode;

  // GOS-70 — a real upload flow now backs this: it is set only by
  // consuming a `photoUploadRef` on `upsertCustomerProfile` (see
  // `UpsertCustomerProfileInput.photoUploadRef`), and always points at a
  // server-processed WebP served by `UploadsController`. Still nullable
  // (a profile may have no photo). The underlying object-storage provider
  // remains a `LocalDevStorageAdapter` placeholder — see infrastructure.md.
  @Field(() => String, { nullable: true })
  photoUrl?: string | null;

  // GOS-62 — explicit opt-in location-sharing consent flag ONLY (no
  // latitude/longitude, no real geolocation logic — see DEC-005, still
  // status "Proposed"). Defaults `false`.
  @Field(() => Boolean)
  locationSharingEnabled!: boolean;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
