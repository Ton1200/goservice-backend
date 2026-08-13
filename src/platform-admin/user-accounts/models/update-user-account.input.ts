import { Field, InputType } from '@nestjs/graphql';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { UserAccountStatus } from '../../../users/models/user-account-status.enum';

/**
 * ALL fields optional — a PARTIAL PATCH, unlike `SetPlatformSettingInput`'s
 * "always full state" convention. This mutation edits one cell of an
 * existing record at a time from a grid (a different shape of problem):
 * only the fields ACTUALLY PRESENT in the input get updated by
 * `UpdateUserAccountService` — an unset field is left untouched, never
 * silently overwritten to null/empty.
 *
 * NEVER a `password`/`passwordHash` field here, and never will be — see
 * this feature's hard constraint (no raw-password editing from the admin
 * panel, ever). Setting a new password is only ever possible via
 * `forceUserAccountPasswordReset` (triggers the existing reset-code-email
 * flow) followed by the user's own `resetPassword` completion.
 */
@InputType()
export class UpdateUserAccountInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsEmail()
  email?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  phoneCountryCode?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @Field(() => UserAccountStatus, { nullable: true })
  @IsOptional()
  @IsEnum(UserAccountStatus)
  accountStatus?: UserAccountStatus;
}
