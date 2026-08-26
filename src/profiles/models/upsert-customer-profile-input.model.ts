import { Field, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
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
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

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

  // No object-storage provider is decided yet (see infrastructure.md) — a
  // client must upload the image elsewhere itself and pass the resulting
  // URL here; this field only validates shape, it never handles the upload.
  @Field({ nullable: true })
  @IsOptional()
  @IsUrl()
  photoUrl?: string;

  // GOS-62 — explicit opt-in location-sharing consent flag ONLY (no
  // latitude/longitude, no real geolocation logic — see DEC-005, still
  // status "Proposed"). Optional/partial-update semantics, same convention
  // as `photoUrl` above: when omitted on an edit, the currently persisted
  // value is left unchanged (see `upsert-customer-profile.service.ts`) —
  // it is NOT reset to `false`. Only an explicit `true`/`false` in the
  // request body changes it.
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  locationSharingEnabled?: boolean;
}
