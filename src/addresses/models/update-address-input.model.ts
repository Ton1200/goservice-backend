import { Field, Float, InputType } from '@nestjs/graphql';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Same location/label fields as `AddAddressInput`, minus `ownerRole` — an
 * Address never changes which profile owns it (see `UpdateAddressService`).
 * Every field is optional: a genuine partial update, same
 * "`undefined` means unchanged" convention `ProfilesRepository.upsertCustomerProfile`
 * already documents — `label` is the one field where the GraphQL layer
 * cannot express "clear it" via explicit `null` distinctly from "omitted"
 * for a nullable `String` input field in this codebase's current
 * validation setup, so clearing a label (if ever needed) is left for a
 * follow-up rather than guessed at here.
 */
@InputType()
export class UpdateAddressInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  formattedAddress?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  placeId?: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;
}
