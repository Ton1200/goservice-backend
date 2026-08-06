import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { SpecializationRole } from './specialization-role.enum';

/**
 * One entry in `UpsertProfessionalProfileInput.specializations` — one of
 * a professional's trades. `role` has no default: the caller must say
 * explicitly whether this is the PRIMARY trade or a SECONDARY one.
 * `description` is required on every entry, primary and secondary alike
 * (confirmed product decision) — no "empty" specialization that tells a
 * customer nothing. There is no `order` field here: display order is
 * derived server-side from this entry's position in the submitted array
 * (see `UpsertProfessionalProfileService`/`ProfilesRepository`), not
 * client-managed.
 */
@InputType()
export class UpsertProfessionalSpecializationInput {
  @Field(() => ID)
  @IsUUID('4')
  categoryId!: string;

  @Field(() => SpecializationRole)
  @IsEnum(SpecializationRole)
  role!: SpecializationRole;

  @Field()
  @IsString()
  @MinLength(1)
  description!: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(75)
  yearsOfExperience?: number;
}
