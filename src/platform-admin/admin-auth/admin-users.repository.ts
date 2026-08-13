import { Injectable } from '@nestjs/common';
import { AdminUser } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The `adminLogin` read path for `AdminUser` — narrowly scoped to what
 * authentication needs (`findByEmail`). Distinct from
 * `../admin-rbac/admin-roles.repository.ts`'s own `AdminUser` read (which
 * only ever selects `status`/`role.permissions` for permission checks) —
 * see that file's header comment for why two repositories touching the
 * same table is acceptable here (both live inside `PlatformAdminModule`,
 * not across a module boundary).
 */
@Injectable()
export class AdminUsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<AdminUser | null> {
    return this.prisma.adminUser.findUnique({ where: { email } });
  }
}
