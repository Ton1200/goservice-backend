import { Injectable } from '@nestjs/common';
import { Category, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import {
  categoryNameTaken,
  categoryNotFound,
  categoryParentCycle,
} from '../errors/admin-category.errors';
import { UpdateCategoryInput } from '../models/update-category.input';

/**
 * Orchestrates `updateCategory`: a PARTIAL PATCH (only fields actually
 * present in `input` are considered — see `UpdateCategoryInput`'s own
 * comment, especially `parentId`'s `undefined` vs `null` distinction), same
 * pattern as `UpdateUserAccountService`. Owns its own transaction boundary
 * for the same reason that service does.
 *
 * `parentId` re-parenting is validated in TWO steps before anything is
 * written:
 *   1. The target parent must actually exist (`CATEGORY_NOT_FOUND`).
 *   2. It must not create a cycle — the target parent cannot be this
 *      Category itself, nor any of its own descendants
 *      (`CATEGORY_PARENT_CYCLE`, via
 *      `ProfilesRepository.findDescendantCategoryIds`).
 */
@Injectable()
export class UpdateCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesRepository: ProfilesRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async updateCategory(
    adminUserId: string,
    id: string,
    input: UpdateCategoryInput,
  ): Promise<Category> {
    const existing = await this.profilesRepository.findCategoryByIdForAdmin(id);
    if (!existing) {
      throw categoryNotFound(id);
    }

    const data: Prisma.CategoryUncheckedUpdateInput = {};
    const changedFields: string[] = [];
    const changes: Record<string, { old: unknown; new: unknown }> = {};

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed !== existing.name) {
        const duplicate =
          await this.profilesRepository.findCategoryByNameForAdmin(trimmed);
        if (duplicate && duplicate.id !== id) {
          throw categoryNameTaken(trimmed);
        }
        data.name = trimmed;
        changedFields.push('name');
        changes.name = { old: existing.name, new: trimmed };
      }
    }

    if (
      input.displayOrder !== undefined &&
      input.displayOrder !== existing.displayOrder
    ) {
      data.displayOrder = input.displayOrder;
      changedFields.push('displayOrder');
      changes.displayOrder = {
        old: existing.displayOrder,
        new: input.displayOrder,
      };
    }

    if (input.parentId !== undefined && input.parentId !== existing.parentId) {
      const newParentId = input.parentId;
      if (newParentId !== null) {
        if (newParentId === id) {
          throw categoryParentCycle(id);
        }
        const parent =
          await this.profilesRepository.findCategoryByIdForAdmin(newParentId);
        if (!parent) {
          throw categoryNotFound(newParentId);
        }
        const descendantIds =
          await this.profilesRepository.findDescendantCategoryIds([id]);
        if (descendantIds.includes(newParentId)) {
          throw categoryParentCycle(id);
        }
      }
      data.parentId = newParentId;
      changedFields.push('parentId');
      changes.parentId = { old: existing.parentId, new: newParentId };
    }

    if (changedFields.length === 0) {
      // Nothing actually differs from the current state — a legitimate
      // no-op, same as UpdateUserAccountService's own convention. No
      // write, no audit log entry.
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.profilesRepository.updateCategoryForAdmin(
        tx,
        id,
        data,
      );

      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'CATEGORY_UPDATED',
        targetType: 'Category',
        targetKey: id,
        metadata: { changedFields, changes } as Prisma.InputJsonValue,
      });

      return updated;
    });
  }
}
