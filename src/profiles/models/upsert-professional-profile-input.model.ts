import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CountryCode } from './country-code.enum';
import { UpsertProfessionalSpecializationInput } from './upsert-professional-specialization-input.model';

/**
 * Structurally closed input, same convention as
 * `UpsertCustomerProfileInput`: no `userId`/`ownerId`/`creatorId` field,
 * and — critically — no `verificationStatus` field at all. It is
 * structurally impossible to submit a verification status from GraphQL;
 * the global `ValidationPipe({ forbidNonWhitelisted: true })` also rejects
 * any attempt to smuggle it in as an extra variable. That process belongs
 * to a future Identity Verification story.
 *
 * No profile-level `yearsOfExperience` — see
 * `UpsertProfessionalSpecializationInput`'s doc comment.
 */
@InputType()
export class UpsertProfessionalProfileInput {
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  // Full-replace-set semantics: each call replaces the professional's
  // entire specialization list with exactly this set — see
  // `profiles.repository.ts`'s `upsertProfessionalProfile`. Emptiness,
  // duplicate categoryIds, and malformed UUIDs are rejected here at the
  // DTO layer; nonexistent (but well-formed) category IDs are rejected by
  // `UpsertProfessionalProfileService` with `CATEGORY_NOT_FOUND`; a
  // submitted set with zero or more than one `role: PRIMARY` entry is
  // rejected by that same service with `PRIMARY_SPECIALIZATION_REQUIRED`
  // — neither of those two checks can be expressed as a DTO decorator.
  // Display `order` is NOT a field on each item — it's derived server-side
  // from this array's position.
  //
  // `@ValidateNested({ each: true })` + `@Type(...)` is this codebase's
  // first nested-object-array DTO — needed so class-validator actually
  // descends into each `UpsertProfessionalSpecializationInput` instead of
  // only checking that the array itself exists.
  @Field(() => [UpsertProfessionalSpecializationInput])
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique((s: UpsertProfessionalSpecializationInput) => s.categoryId)
  @ValidateNested({ each: true })
  @Type(() => UpsertProfessionalSpecializationInput)
  specializations!: UpsertProfessionalSpecializationInput[];

  @Field()
  @IsString()
  @MinLength(1)
  city!: string;

  // Optional — defaults server-side to AR (Argentina) when omitted, same
  // convention as `UpsertCustomerProfileInput.country`. `@IsEnum` (not
  // `@IsString() @Length(2, 2)`) — see that field's own comment for why.
  @Field(() => CountryCode, { nullable: true })
  @IsOptional()
  @IsEnum(CountryCode)
  country?: CountryCode;

  @Field()
  @IsString()
  @MinLength(1)
  serviceAreaDescription!: string;

  @Field()
  @IsString()
  @MinLength(1)
  bio!: string;

  // No object-storage provider is decided yet (see infrastructure.md) — a
  // client must upload the image elsewhere itself and pass the resulting
  // URL here; this field only validates shape, it never handles the upload.
  @Field({ nullable: true })
  @IsOptional()
  @IsUrl()
  photoUrl?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  languages?: string[];

  // GOS-62 — same explicit opt-in location-sharing consent flag as
  // `UpsertCustomerProfileInput.locationSharingEnabled` (see that field's
  // own comment for the full rationale and partial-update semantics).
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  locationSharingEnabled?: boolean;
}
