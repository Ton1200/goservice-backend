import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { CountryCode } from './country-code.enum';

/**
 * A client's profile — GOS-14/GOS-28. `userId` is deliberately NOT exposed
 * here: `myCustomerProfile` is always implicitly "mine" via
 * `@CurrentUser()`, and nothing in this story needs the raw FK
 * client-side. Adding it later is a purely additive, non-breaking field.
 */
@ObjectType()
export class CustomerProfile {
  @Field(() => ID)
  id!: string;

  @Field()
  displayName!: string;

  @Field()
  addressLine!: string;

  @Field()
  city!: string;

  @Field()
  province!: string;

  @Field(() => CountryCode)
  country!: CountryCode;

  // No object-storage provider is decided yet — see infrastructure.md —
  // so this is just a URL string, nullable until a real upload flow exists.
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
