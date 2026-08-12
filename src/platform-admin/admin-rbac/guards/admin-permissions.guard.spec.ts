import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '@prisma/client';
import { AdminRbacService } from '../services/admin-rbac.service';
import { AdminPermissionsGuard } from './admin-permissions.guard';

function makeExecutionContext(req: unknown): ExecutionContext {
  return {
    getType: () => 'graphql',
    getArgs: () => [{}, {}, { req }, {}],
    getClass: () => class {},
    getHandler: () => (): void => undefined,
  } as unknown as ExecutionContext;
}

describe('AdminPermissionsGuard', () => {
  function makeGuard(options: {
    required?: Permission[];
    hasAllPermissions?: boolean;
  }) {
    const getAllAndOverride = jest.fn().mockReturnValue(options.required ?? []);
    const reflector = { getAllAndOverride } as unknown as Reflector;

    const hasAllPermissions = jest
      .fn()
      .mockResolvedValue(options.hasAllPermissions ?? true);
    const adminRbacService = {
      hasAllPermissions,
    } as unknown as AdminRbacService;

    const guard = new AdminPermissionsGuard(reflector, adminRbacService);
    return { guard, hasAllPermissions };
  }

  it('allows the request through when no @RequireAdminPermissions metadata is present', async () => {
    const { guard, hasAllPermissions } = makeGuard({ required: [] });
    const req = { adminUserId: 'admin-1' };

    await expect(guard.canActivate(makeExecutionContext(req))).resolves.toBe(
      true,
    );
    expect(hasAllPermissions).not.toHaveBeenCalled();
  });

  it('allows the request through when the admin has all required permissions', async () => {
    const { guard, hasAllPermissions } = makeGuard({
      required: [Permission.FEATURE_FLAGS_WRITE],
      hasAllPermissions: true,
    });
    const req = { adminUserId: 'admin-1' };

    await expect(guard.canActivate(makeExecutionContext(req))).resolves.toBe(
      true,
    );
    expect(hasAllPermissions).toHaveBeenCalledWith('admin-1', [
      Permission.FEATURE_FLAGS_WRITE,
    ]);
  });

  it('rejects with ADMIN_FORBIDDEN when the admin lacks a required permission', async () => {
    const { guard } = makeGuard({
      required: [Permission.FEATURE_FLAGS_WRITE],
      hasAllPermissions: false,
    });
    const req = { adminUserId: 'admin-1' };

    await expect(
      guard.canActivate(makeExecutionContext(req)),
    ).rejects.toMatchObject({
      code: 'ADMIN_FORBIDDEN',
      message: 'You do not have permission to perform this action.',
    });
  });

  it('rejects with ADMIN_FORBIDDEN when permissions are required but req.adminUserId is missing (guard ran without AdminSessionGuard first)', async () => {
    const { guard, hasAllPermissions } = makeGuard({
      required: [Permission.FEATURE_FLAGS_READ],
    });
    const req = {};

    await expect(
      guard.canActivate(makeExecutionContext(req)),
    ).rejects.toMatchObject({ code: 'ADMIN_FORBIDDEN' });
    expect(hasAllPermissions).not.toHaveBeenCalled();
  });
});
