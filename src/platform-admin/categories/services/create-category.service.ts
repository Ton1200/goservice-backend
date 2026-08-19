import { Injectable } from '@nestjs/common';
import { Category } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import {
  categoryNameTaken,
  categoryNotFound,
} from '../errors/admin-category.errors';
import { CreateCategoryInput } from '../models/create-category.input';

/**
 * Orchestrates `createCategory`. This service owns the transaction
 * boundary (injects `PrismaService` directly, same pattern
 * `UpdateUserAccountService`/`CreateServiceRequestForCustomerService`
 * already establish) because it spans two tables owned by two different
 * repositories (`ProfilesRepository`, `AuditLogRepository`) that must
 * commit atomically or not at all.
 *
 * Validation order: name uniqueness (case-insensitive), THEN parent
 * existence (if `parentId` given) — both real server-side checks, not
 * relying on the raw DB `@unique`/FK constraint to surface a clean error.
 * No cycle check is needed here: a brand-new Category cannot already be
 * anyone's ancestor.
 */
@Injectable()
export class CreateCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesRepository: ProfilesRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async createCategory(
    adminUserId: string,
    input: CreateCategoryInput,
  ): Promise<Category> {
    const name = input.name.trim();
    const duplicate =
      await this.profilesRepository.findCategoryByNameForAdmin(name);
    if (duplicate) {
      throw categoryNameTaken(name);
    }

    let parentId: string | null = null;
    if (input.parentId !== undefined) {
      const parent = await this.profilesRepository.findCategoryByIdForAdmin(
        input.parentId,
      );
      if (!parent) {
        throw categoryNotFound(input.parentId);
      }
      parentId = input.parentId;
    }

    const displayOrder = input.displayOrder ?? 0;

    return this.prisma.$transaction(async (tx) => {
      const created = await this.profilesRepository.createCategoryForAdmin(tx, {
        name,
        displayOrder,
        parentId,
      });

      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'CATEGORY_CREATED',
        targetType: 'Category',
        targetKey: created.id,
        metadata: { name, displayOrder, parentId },
      });

      return created;
    });
  }
}
