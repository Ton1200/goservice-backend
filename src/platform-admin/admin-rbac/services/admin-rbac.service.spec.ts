import { AdminUserStatus, Permission } from '@prisma/client';
import { AdminRolesRepository } from '../admin-roles.repository';
import { AdminRbacService } from './admin-rbac.service';

describe('AdminRbacService', () => {
  function makeService(result: unknown) {
    const findEffectivePermissions = jest.fn().mockResolvedValue(result);
    const adminRolesRepository = {
      findEffectivePermissions,
    } as unknown as AdminRolesRepository;
    const service = new AdminRbacService(adminRolesRepository);
    return { service, findEffectivePermissions };
  }

  it('returns true immediately for an empty required-permissions list, without querying the repository', async () => {
    const { service, findEffectivePermissions } = makeService(null);

    await expect(service.hasAllPermissions('admin-1', [])).resolves.toBe(true);
    expect(findEffectivePermissions).not.toHaveBeenCalled();
  });

  it('returns true when the admin holds all required permissions', async () => {
    const { service } = makeService({
      status: AdminUserStatus.ACTIVE,
      permissions: [
        Permission.FEATURE_FLAGS_READ,
        Permission.FEATURE_FLAGS_WRITE,
      ],
    });

    await expect(
      service.hasAllPermissions('admin-1', [Permission.FEATURE_FLAGS_WRITE]),
    ).resolves.toBe(true);
  });

  it('returns false when the admin is missing at least one required permission', async () => {
    const { service } = makeService({
      status: AdminUserStatus.ACTIVE,
      permissions: [Permission.FEATURE_FLAGS_READ],
    });

    await expect(
      service.hasAllPermissions('admin-1', [Permission.FEATURE_FLAGS_WRITE]),
    ).resolves.toBe(false);
  });

  it('returns false for a REVOKED admin, even if their role would otherwise grant the permission — no snapshot, always re-queried', async () => {
    const { service } = makeService({
      status: AdminUserStatus.REVOKED,
      permissions: [Permission.FEATURE_FLAGS_WRITE],
    });

    await expect(
      service.hasAllPermissions('admin-1', [Permission.FEATURE_FLAGS_WRITE]),
    ).resolves.toBe(false);
  });

  it('returns false when the admin user cannot be found at all', async () => {
    const { service } = makeService(null);

    await expect(
      service.hasAllPermissions('unknown-admin', [
        Permission.FEATURE_FLAGS_READ,
      ]),
    ).resolves.toBe(false);
  });

  it('hasPermission delegates to hasAllPermissions with a single-item array', async () => {
    const { service } = makeService({
      status: AdminUserStatus.ACTIVE,
      permissions: [Permission.AUDIT_LOG_READ],
    });

    await expect(
      service.hasPermission('admin-1', Permission.AUDIT_LOG_READ),
    ).resolves.toBe(true);
  });
});
