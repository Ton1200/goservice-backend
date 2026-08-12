import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { CurrentAdminUser } from '../admin-auth/decorators/current-admin-user.decorator';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { PlatformSettingModel } from './models/platform-setting.model';
import { SetPlatformSettingInput } from './models/set-platform-setting.input';
import { ListPlatformSettingsService } from './services/list-platform-settings.service';
import { SetPlatformSettingService } from './services/set-platform-setting.service';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`,
 * the order that guarantees `req.adminUserId` exists before the permissions
 * guard reads it). `platformSettings` (read) requires `FEATURE_FLAGS_READ`;
 * `setPlatformSetting` (write) requires `FEATURE_FLAGS_WRITE` — the SAME
 * two permission names Slice 1's `FeatureFlagsResolver` already used,
 * deliberately reused rather than introducing a separate
 * `CREDENTIALS_READ`/`CREDENTIALS_WRITE`-shaped gate now that both flags
 * and credentials live in one table/one resolver (flagged in this change's
 * report for explicit reviewer sign-off, per the consolidation plan's
 * instruction not to silently decide a stricter gate is warranted).
 *
 * Never returns plaintext/decrypted credential material — see
 * `PlatformSettingModel`'s own header comment and
 * `PlatformSettingFieldResolver`; this is non-negotiable.
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class PlatformSettingsResolver {
  constructor(
    private readonly listPlatformSettingsService: ListPlatformSettingsService,
    private readonly setPlatformSettingService: SetPlatformSettingService,
  ) {}

  @RequireAdminPermissions(Permission.FEATURE_FLAGS_READ)
  @Query(() => [PlatformSettingModel], {
    description:
      'Lists every platform setting (flags AND credentials — masked preview only for encrypted ones, never the real value).',
  })
  platformSettings(): Promise<PlatformSettingModel[]> {
    return this.listPlatformSettingsService.listPlatformSettings();
  }

  @RequireAdminPermissions(Permission.FEATURE_FLAGS_WRITE)
  @Mutation(() => PlatformSettingModel, {
    description:
      'Creates or updates a platform setting by key, writing an AdminAuditLog row in the same transaction. Never returns a decrypted value.',
  })
  setPlatformSetting(
    @CurrentAdminUser() adminUserId: string,
    @Args('input') input: SetPlatformSettingInput,
  ): Promise<PlatformSettingModel> {
    return this.setPlatformSettingService.setPlatformSetting(
      adminUserId,
      input,
    );
  }
}
