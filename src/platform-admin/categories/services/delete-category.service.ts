import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { ServiceRequestsRepository } from '../../../service-requests/service-requests.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import {
  categoryInUse,
  categoryNotFound,
} from '../errors/admin-category.errors';
import { DeleteCategoryPayload } from '../models/delete-category-payload.model';

/**
 * Orchestrates `deleteCategory` — a REAL, hard delete (confirmed,
 * human-authorized decision: BLOCK the delete rather than soft-delete when
 * the Category is still in use — see this feature's own design
 * conversation). Blocked, with a clear `CATEGORY_IN_USE` error, for any of
 * THREE reasons, checked in parallel before anything is written:
 *   1. At least one `ServiceRequest` still references it
 *      (`ServiceRequestsRepository.countByCategoryId`).
 *   2. At least one `ProfessionalSpecialization` still references it
 *      (`ProfilesRepository.countSpecializationsByCategoryId`).
 *   3. It still has at least one CHILD Category
 *      (`ProfilesRepository.countChildCategories`) — deleting it would
 *      either orphan or cascade-delete an entire subtree, neither of which
 *      this feature does; an admin must re-parent or delete the children
 *      first.
 * Postgres's own `onDelete: Restrict` on `Category.parentId` backs up
 * reason 3 at the DB level too (defense in depth, not just a UI/service
 * check).
 */
@Injectable()
export class DeleteCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesRepository: ProfilesRepository,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async deleteCategory(
    adminUserId: string,
    id: string,
  ): Promise<DeleteCategoryPayload> {
    const existing = await this.profilesRepository.findCategoryByIdForAdmin(id);
    if (!existing) {
      throw categoryNotFound(id);
    }

    const [serviceRequestCount, specializationCount, childCount] =
      await Promise.all([
        this.serviceRequestsRepository.countByCategoryId(id),
        this.profilesRepository.countSpecializationsByCategoryId(id),
        this.profilesRepository.countChildCategories(id),
      ]);

    if (childCount > 0) {
      throw categoryInUse(
        `it still has ${childCount} child ${childCount === 1 ? 'category' : 'categories'} — re-parent or delete them first`,
      );
    }
    if (serviceRequestCount > 0) {
      throw categoryInUse(
        `it is still referenced by ${serviceRequestCount} ServiceRequest${serviceRequestCount === 1 ? '' : 's'}`,
      );
    }
    if (specializationCount > 0) {
      throw categoryInUse(
        `it is still referenced by ${specializationCount} professional specialization${specializationCount === 1 ? '' : 's'}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'CATEGORY_DELETED',
        targetType: 'Category',
        targetKey: id,
        metadata: { name: existing.name, parentId: existing.parentId },
      });

      await this.profilesRepository.deleteCategoryForAdmin(tx, id);
    });

    return { success: true };
  }
}
