import { Field, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsDate,
  IsEmail,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * Structurally closed input: no address/country/city/province/postal
 * fields exist here or anywhere in this story's DTOs — GoService is not
 * modeling a checkout-shaped address concept in this story (see
 * CLAUDE.md's e-commerce-shape prohibition).
 */
@InputType()
export class RegisterInput {
  @Field()
  @IsString()
  @MinLength(1)
  firstName!: string;

  @Field()
  @IsString()
  @MinLength(1)
  lastName!: string;

  @Field()
  @IsEmail()
  email!: string;

  // Minimum length only — a full password-strength policy is not specified
  // by GOS-8/22 and is not invented here.
  @Field()
  @IsString()
  @MinLength(8)
  password!: string;

  @Field()
  @IsString()
  phoneCountryCode!: string;

  @Field()
  @IsString()
  phoneNumber!: string;

  // `Date` here is the native JS class, associated with the custom 'Date'
  // GraphQL scalar via `DateScalar`'s `@Scalar('Date', () => Date)`
  // registration (see `common/graphql/date.scalar.ts`) — NOT a reference
  // to the `DateScalar` resolver class itself, which is a provider, not a
  // GraphQL type.
  @Field(() => Date)
  @IsDate()
  dateOfBirth!: Date;

  @Field()
  @IsBoolean()
  acceptedTermsAndPrivacy!: boolean;
}
