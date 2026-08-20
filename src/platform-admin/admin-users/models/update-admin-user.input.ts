import { Field, ID, InputType } from '@nestjs/graphql';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { AdminUserStatus } from '../../admin-auth/models/admin-user-status.enum';

/**
 * ALL fields optional — a PARTIAL PATCH, same convention
 * `UpdateUserAccountInput` establishes: only fields ACTUALLY PRESENT in the
 * input are considered by `UpdateAdminUserService`.
 *
 * NEVER an `email`/`password`/`passwordHash` field here, and never will be:
 * an admin's email is fixed at invite time (identity for `adminLogin`), and
 * setting a password is only ever possible via the invite/accept flow —
 * there is no admin-panel path to set another admin's password directly.
 *
 * `status` accepts `ACTIVE`/`REVOKED` only in practice — submitting
 * `INVITED` is rejected (`ADMIN_USER_INVALID_STATUS_TRANSITION`): `INVITED`
 * is only ever reachable via `inviteAdminUser`, never a manual status edit.
 */
@InputType()
export class UpdateAdminUserInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  displayName?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @Field(() => AdminUserStatus, { nullable: true })
  @IsOptional()
  @IsEnum(AdminUserStatus)
  status?: AdminUserStatus;
}
