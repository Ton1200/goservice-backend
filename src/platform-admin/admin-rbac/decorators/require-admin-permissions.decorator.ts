import { SetMetadata } from '@nestjs/common';
import { Permission } from '@prisma/client';

export const ADMIN_PERMISSIONS_METADATA_KEY = 'admin:requiredPermissions';

/**
 * Declares the `Permission`s a resolver method requires — read by
 * `AdminPermissionsGuard` (`../guards/admin-permissions.guard.ts`) via
 * `Reflector`. Always combine with `@UseGuards(AdminSessionGuard,
 * AdminPermissionsGuard)`, in that order: `AdminSessionGuard` must run
 * first to attach `req.adminUserId`, which `AdminPermissionsGuard` then
 * reads. A method decorated with `@RequireAdminPermissions()` and no guard
 * is NOT protected — the metadata alone enforces nothing.
 */
export const RequireAdminPermissions = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(ADMIN_PERMISSIONS_METADATA_KEY, permissions);
