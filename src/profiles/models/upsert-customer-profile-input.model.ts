import { Field, InputType } from '@nestjs/graphql';
import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

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

  // Optional — defaults server-side to "AR" (Argentina) when omitted, so
  // the current single-market mobile app never has to send it. See
  // `upsert-customer-profile.service.ts`.
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  // No object-storage provider is decided yet (see infrastructure.md) — a
  // client must upload the image elsewhere itself and pass the resulting
  // URL here; this field only validates shape, it never handles the upload.
  @Field({ nullable: true })
  @IsOptional()
  @IsUrl()
  photoUrl?: string;
}
