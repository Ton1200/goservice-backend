import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { CurrentAdminUser } from '../admin-auth/decorators/current-admin-user.decorator';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { StorageSettingsModel } from './models/storage-settings.model';
import { UpdateStorageSettingsInput } from './models/update-storage-settings.input';
import { GetStorageSettingsService } from './services/get-storage-settings.service';
import { UpdateStorageSettingsService } from './services/update-storage-settings.service';

/**
 * GOS-70 — the dedicated admin surface for the storage / image-processing
 * knobs, isolated from the generic `platformSettings` / `setPlatformSetting`
 * so it carries its OWN `STORAGE_SETTINGS_*` permission (a role can be
 * granted storage-config access without full feature-flag/credential
 * access). Same guard ordering as every other platform-admin resolver
 * (`AdminSessionGuard` THEN `AdminPermissionsGuard`).
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminStorageSettingsResolver {
  constructor(
    private readonly getStorageSettingsService: GetStorageSettingsService,
    private readonly updateStorageSettingsService: UpdateStorageSettingsService,
  ) {}

  @RequireAdminPermissions(Permission.STORAGE_SETTINGS_READ)
  @Query(() => StorageSettingsModel, {
    description:
      'The current storage / image-processing settings (profile-photo upload toggle, processed-image max dimension and WebP quality).',
  })
  storageSettings(): Promise<StorageSettingsModel> {
    return this.getStorageSettingsService.getStorageSettings();
  }

  @RequireAdminPermissions(Permission.STORAGE_SETTINGS_WRITE)
  @Mutation(() => StorageSettingsModel, {
    description:
      'Updates all storage / image-processing settings at once, writing an AdminAuditLog row in the same transaction.',
  })
  updateStorageSettings(
    @CurrentAdminUser() adminUserId: string,
    @Args('input') input: UpdateStorageSettingsInput,
  ): Promise<StorageSettingsModel> {
    return this.updateStorageSettingsService.updateStorageSettings(
      adminUserId,
      input,
    );
  }
}
