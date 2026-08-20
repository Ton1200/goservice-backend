import { Field, InputType } from '@nestjs/graphql';
import {
  IsArray,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Permission } from '../../admin-rbac/admin-permission.enum';

/**
 * `createAdminRole`'s input — a brand-new, admin-creatable role (unlike the
 * 3 seeded roles, this one has no name restriction from
 * `SEEDED_ADMIN_ROLE_NAMES` — see `CreateAdminRoleService`). `permissions`
 * is the role's FULL initial set, same "checkbox-matrix sends the whole
 * array" convention `UpdateAdminRolePermissionsInput`-shaped arguments use
 * throughout this feature.
 */
@InputType()
export class CreateAdminRoleInput {
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @Field(() => [Permission])
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions!: Permission[];
}
