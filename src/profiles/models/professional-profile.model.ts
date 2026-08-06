import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { ProfessionalSpecialization } from './professional-specialization.model';
import { ProfessionalVerificationStatus } from './professional-verification-status.enum';

/**
 * A professional's profile — GOS-14/GOS-28. `userId` is deliberately NOT
 * exposed, same rationale as `CustomerProfile`. `verificationStatus` is
 * readable here but has no corresponding writable field anywhere in
 * `UpsertProfessionalProfileInput` — it can only ever be `UNVERIFIED` in
 * this story.
 *
 * No profile-level `yearsOfExperience` — experience lives per
 * specialization (see `ProfessionalSpecialization`), since a professional
 * can have very different experience in their primary trade vs. a
 * secondary one. `bio` remains a general "about me," distinct from each
 * specialization's own `description`.
 */
@ObjectType()
export class ProfessionalProfile {
  @Field(() => ID)
  id!: string;

  @Field()
  displayName!: string;

  // Ordered by `order` ascending — the PRIMARY specialization is not
  // guaranteed to be first in this list by position; check each item's
  // `role` instead of assuming array order implies primary/secondary.
  @Field(() => [ProfessionalSpecialization])
  specializations!: ProfessionalSpecialization[];

  @Field()
  city!: string;

  @Field()
  country!: string;

  @Field()
  serviceAreaDescription!: string;

  @Field()
  bio!: string;

  // No object-storage provider is decided yet — see infrastructure.md —
  // so this is just a URL string, nullable until a real upload flow exists.
  @Field(() => String, { nullable: true })
  photoUrl?: string | null;

  @Field(() => [String])
  languages!: string[];

  @Field(() => ProfessionalVerificationStatus)
  verificationStatus!: ProfessionalVerificationStatus;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
