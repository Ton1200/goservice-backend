import { Injectable, Logger } from '@nestjs/common';
import { UserAccountStatus } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { accountNotApproved } from '../../../identity-verification/errors/account-not-approved.error';
import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { customerProfileRequired } from '../../../service-requests/errors/customer-profile-required.error';
import { invalidServiceRequestBudgetRange } from '../../../service-requests/errors/invalid-service-request-budget-range.error';
import { ServiceRequestsRepository } from '../../../service-requests/service-requests.repository';
import { UsersRepository } from '../../../users/users.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { userAccountNotFound } from '../../user-accounts/errors/user-account.errors';
import { AdminCreateServiceRequestInput } from '../models/admin-create-service-request-input.model';
import { AdminServiceRequestModel } from '../models/admin-service-request.model';
import { toAdminServiceRequestModel } from '../models/to-admin-service-request-model.util';

/**
 * Orchestrates `createServiceRequestForCustomer` — an admin creates a
 * `ServiceRequest` ON BEHALF OF a Customer. This service owns the
 * transaction boundary (injects `PrismaService` directly, same pattern
 * `UpdateUserAccountService` already establishes) because it spans two
 * tables owned by two different repositories (`ServiceRequestsRepository`,
 * `AuditLogRepository`) that must commit atomically or not at all.
 *
 * Every validation below is a REAL server-side check, not just "trust the
 * picker" — `eligibleServiceRequestCustomers` only narrows what an admin is
 * shown; this is what actually enforces it:
 *   1. `userId` must resolve to a real `User`.
 *   2. That `User.accountStatus` must be `APPROVED` — this project's
 *      "identity validated" state (see `UserAccountStatus`'s own schema
 *      comment) — the human's explicit requirement for this feature.
 *   3. That `User` must already have a `CustomerProfile` (the FK
 *      `ServiceRequest.customerProfileId` requires one to exist) — an
 *      APPROVED account with only a `ProfessionalProfile` and no
 *      `CustomerProfile` is rejected the same way the consumer-facing
 *      `publishServiceRequest` treats its own (structurally impossible in
 *      that path, but real here since an admin can target ANY user)
 *      missing-profile case.
 *   4. `category` must reference a real `Category` — same reused
 *      `CATEGORY_NOT_FOUND` code `PublishServiceRequestService` already
 *      uses, never duplicated under a new name.
 *   5. `indicativeBudgetMin`/`indicativeBudgetMax`, if both present, must
 *      satisfy `min <= max` — same reused check/code as the consumer path.
 *
 * Never accepts/creates attachments — no upload-ref flow exists in the
 * admin panel (see `AdminCreateServiceRequestInput`'s own comment).
 */
@Injectable()
export class CreateServiceRequestForCustomerService {
  private readonly logger = new Logger(
    CreateServiceRequestForCustomerService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersRepository: UsersRepository,
    private readonly profilesRepository: ProfilesRepository,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async createServiceRequestForCustomer(
    adminUserId: string,
    input: AdminCreateServiceRequestInput,
  ): Promise<AdminServiceRequestModel> {
    const accountStatus = await this.usersRepository.findAccountStatusById(
      input.userId,
    );
    if (accountStatus === null) {
      throw userAccountNotFound(input.userId);
    }
    if (accountStatus !== UserAccountStatus.APPROVED) {
      throw accountNotApproved();
    }

    const customerProfile =
      await this.profilesRepository.findCustomerProfileByUserId(input.userId);
    if (!customerProfile) {
      throw customerProfileRequired();
    }

    const existingCategoryIds =
      await this.profilesRepository.findExistingCategoryIds([input.category]);
    if (existingCategoryIds.length === 0) {
      // Same code `publishServiceRequest`/`upsertProfessionalProfile`
      // already use for a nonexistent category — reused, not duplicated.
      throw new DomainException(
        'CATEGORY_NOT_FOUND',
        `The following category IDs do not exist: ${input.category}.`,
      );
    }

    if (
      input.indicativeBudgetMin !== undefined &&
      input.indicativeBudgetMax !== undefined &&
      input.indicativeBudgetMin > input.indicativeBudgetMax
    ) {
      throw invalidServiceRequestBudgetRange();
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await this.serviceRequestsRepository.createForAdmin(tx, {
        customerProfileId: customerProfile.id,
        categoryId: input.category,
        description: input.description,
        urgency: input.urgency,
        indicativeBudgetMin: input.indicativeBudgetMin ?? null,
        indicativeBudgetMax: input.indicativeBudgetMax ?? null,
      });

      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'SERVICE_REQUEST_CREATED_BY_ADMIN',
        targetType: 'ServiceRequest',
        targetKey: created.id,
        metadata: {
          customerUserId: input.userId,
          customerProfileId: customerProfile.id,
          categoryId: input.category,
        },
      });

      return created;
    });

    this.logger.log({
      event: 'service_request_created_by_admin',
      outcome: 'success',
      serviceRequestId: row.id,
      customerUserId: input.userId,
    });

    return toAdminServiceRequestModel(row);
  }
}
