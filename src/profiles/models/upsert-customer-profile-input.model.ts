import { Field, ID, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CountryCode } from './country-code.enum';

/**
 * Structurally closed input: no `userId`/`ownerId`/`creatorId` field exists
 * here or anywhere in this module's DTOs — the authenticated user is always
 * taken from the session (`@CurrentUser()`), never from the input. See
 * `src/users/models/register-input.model.ts` for the same convention.
 */
@InputType()
export class UpsertCustomerProfileInput {
  // The person's real name, split into two fields (nombre / apellido) —
  // replaced the former single free-text `displayName`. `@MaxLength(80)`
  // each: the old combined field was 1..120, so 80 + 80 comfortably covers
  // any real name that used to fit. No `@Transform`/trim — no other field
  // in this DTO trims either.
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @Field()
  @IsString()
  @MinLength(1)
  addressLine!: string;

  @Field()
  @IsString()
  @MinLength(1)
  city!: string;

  @Field()
  @IsString()
  @MinLength(1)
  province!: string;

  // Optional — defaults server-side to AR (Argentina) when omitted, so
  // the current single-market mobile app never has to send it. See
  // `upsert-customer-profile.service.ts`. `@IsEnum` (not
  // `@IsString() @Length(2, 2)`) since `CountryCode` is now a real Prisma
  // enum, not a bare String — see that enum's own comment
  // (`country-code.enum.ts`) for why.
  @Field(() => CountryCode, { nullable: true })
  @IsOptional()
  @IsEnum(CountryCode)
  country?: CountryCode;

  // GOS-70 — the ONLY way to set a profile photo. The client first calls
  // `requestProfilePhotoUploadUrl`, PUTs the image bytes to the signed
  // `uploadUrl` (server-side resized + re-encoded to WebP), then passes the
  // returned `ref` here. When present the server sets `photoUrl` to the
  // processed WebP URL and marks the ref consumed in the same transaction.
  // Omitting it on an edit leaves the currently persisted photo unchanged.
  // The former free `photoUrl` string field was removed (breaking) — an
  // arbitrary client-supplied URL is no longer accepted.
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  photoUploadRef?: string;

  // GOS-62 — explicit opt-in location-sharing consent flag ONLY (no
  // latitude/longitude, no real geolocation logic — see DEC-005, still
  // status "Proposed"). Optional/partial-update semantics: when omitted on
  // an edit, the currently persisted value is left unchanged (see
  // `upsert-customer-profile.service.ts`) — it is NOT reset to `false`.
  // Only an explicit `true`/`false` in the request body changes it.
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  locationSharingEnabled?: boolean;
}
