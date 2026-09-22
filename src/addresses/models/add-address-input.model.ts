import { Field, Float, InputType } from '@nestjs/graphql';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AddressOwnerRole } from './address-owner-role.enum';

/**
 * Unlike `PostQuoteNegotiationMessageInput`'s fully server-resolved party
 * (a Quote's two sides already disambiguate who is acting), `ownerRole`
 * here is genuinely client-supplied: nothing else on this input tells the
 * server which of the caller's own profiles (`CustomerProfile` or
 * `ProfessionalProfile`) a dual-role User means to save this Address
 * under. `AddAddressService` still verifies the caller actually HOLDS that
 * profile type before writing anything — see `addressOwnerProfileNotFound()`.
 *
 * `latitude`/`longitude` are validated only for being a real coordinate
 * pair (-90..90 / -180..180). A tighter Argentina/Colombia bounding-box
 * check is explicitly OUT of scope here — TBD, no confirmed coordinate
 * range exists for one yet; inventing a number would risk rejecting a real
 * address near a border.
 *
 * `formattedAddress`/`placeId` are opaque values already resolved by the
 * Google Places SDK on the mobile app — this backend never calls Google
 * and never re-validates their shape beyond non-empty.
 */
@InputType()
export class AddAddressInput {
  @Field(() => AddressOwnerRole)
  @IsEnum(AddressOwnerRole)
  ownerRole!: AddressOwnerRole;

  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  formattedAddress!: string;

  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  placeId!: string;

  @Field(() => Float)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Field(() => Float)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;
}
