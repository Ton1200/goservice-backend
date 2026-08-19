import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ServiceRequestAttachmentUploadRef,
  ServiceRequestAttachmentUploadRefStatus,
  ServiceRequestStatus,
  ServiceRequestUrgency,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const SERVICE_REQUEST_INCLUDE = {
  category: true,
  // Stable, explicit order — see `ServiceRequestAttachment.order`'s own
  // schema comment for why this isn't just `createdAt`.
  attachments: { orderBy: { order: 'asc' as const } },
} satisfies Prisma.ServiceRequestInclude;

export type ServiceRequestWithRelations = Prisma.ServiceRequestGetPayload<{
  include: typeof SERVICE_REQUEST_INCLUDE;
}>;

// ---- platform-admin `serviceRequests`/`serviceRequestDetail` capability
// (GOS-38 follow-up, 2026-08-18) — same "reuse the concrete repository
// class directly, never import the resolver-bearing ServiceRequestsModule"
// pattern `UsersRepository`'s own `ADMIN_USER_ACCOUNT_SELECT`/
// `findManyForAdmin`/`countAllForAdmin` already establish for
// `platform-admin/user-accounts/`. `customerProfile.user` is the "relación
// de usuarios" an admin needs to make each row actionable — never just an
// opaque `customerProfileId`.

/**
 * Grid-row select — deliberately lighter than
 * `ADMIN_SERVICE_REQUEST_DETAIL_SELECT` below (no `attachments` rows, only
 * a count via `_count`), same "cheap select for the grid, richer select for
 * the one-row detail view" split `UsersRepository`'s own
 * `ADMIN_USER_ACCOUNT_SELECT`/`ADMIN_USER_ACCOUNT_DETAIL_SELECT` already
 * establish.
 */
const ADMIN_SERVICE_REQUEST_SELECT = {
  id: true,
  description: true,
  urgency: true,
  indicativeBudgetMin: true,
  indicativeBudgetMax: true,
  status: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  // Full Category row (not just id/name) — AdminServiceRequestModel/
  // AdminServiceRequestDetailModel reuse the full consumer-facing
  // `Category` @ObjectType shape (createdAt/updatedAt included), same
  // "orphaned type made reachable" pattern as userAccountDetail's own
  // customerProfile/professionalProfile fields.
  category: true,
  customerProfile: {
    select: {
      id: true,
      displayName: true,
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
  },
  _count: { select: { attachments: true } },
} satisfies Prisma.ServiceRequestSelect;

export type AdminServiceRequestRow = Prisma.ServiceRequestGetPayload<{
  select: typeof ADMIN_SERVICE_REQUEST_SELECT;
}>;

/**
 * One-row detail select — adds the full `attachments` list (ordered, same
 * as the consumer-facing `SERVICE_REQUEST_INCLUDE` above) on top of
 * everything `ADMIN_SERVICE_REQUEST_SELECT` already carries.
 */
const ADMIN_SERVICE_REQUEST_DETAIL_SELECT = {
  ...ADMIN_SERVICE_REQUEST_SELECT,
  attachments: {
    select: { id: true, url: true, createdAt: true },
    orderBy: { order: 'asc' as const },
  },
} satisfies Prisma.ServiceRequestSelect;

export type AdminServiceRequestDetailRow = Prisma.ServiceRequestGetPayload<{
  select: typeof ADMIN_SERVICE_REQUEST_DETAIL_SELECT;
}>;

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `ServiceRequest`/`ServiceRequestAttachment`/
 * `ServiceRequestAttachmentUploadRef` — same data-ownership rule as
 * `ProfilesRepository`/`UsersRepository` (see
 * goservice-docs/architecture/backend.md). `Category` queries are
 * deliberately NOT duplicated here — `PublishServiceRequestService` calls
 * `ProfilesRepository.findExistingCategoryIds` directly, since `Category`
 * belongs to `profiles/`'s table ownership, not this module's.
 */
@Injectable()
export class ServiceRequestsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns only the refs that are actually usable right now: owned by
   * `userId`, still `PENDING`, and not yet expired. The caller
   * (`PublishServiceRequestService`) diffs the returned rows' ids against
   * the full submitted `refIds` list — any id missing from this result is
   * invalid for one of the reasons `invalidAttachmentUploadRef()`
   * describes (doesn't exist / not yours / already consumed / expired),
   * all deliberately collapsed into a single generic check here rather
   * than four separate queries, since the caller only needs a yes/no per
   * ref, never which specific reason applied (anti-enumeration).
   */
  findUsablePendingUploadRefs(
    userId: string,
    refIds: string[],
  ): Promise<ServiceRequestAttachmentUploadRef[]> {
    return this.prisma.serviceRequestAttachmentUploadRef.findMany({
      where: {
        id: { in: refIds },
        userId,
        status: ServiceRequestAttachmentUploadRefStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
    });
  }

  createUploadRef(data: {
    userId: string;
    storageKey: string;
    fileUrl: string;
    expiresAt: Date;
  }): Promise<ServiceRequestAttachmentUploadRef> {
    return this.prisma.serviceRequestAttachmentUploadRef.create({ data });
  }

  /**
   * Creates the `ServiceRequest` and its `ServiceRequestAttachment` rows
   * (one per validated ref, in the client-submitted array order — see
   * `order`'s own schema comment), then marks every consumed ref
   * `CONSUMED` — all inside one transaction, so a `ServiceRequest` is
   * never left with a partial attachment set, and a ref can never be
   * "spent" without a `ServiceRequest` actually existing to show for it.
   * `attachmentRefs` must already be the validated
   * `ServiceRequestAttachmentUploadRef` rows (see
   * `findUsablePendingUploadRefs`) — this method does not re-validate
   * ownership/expiration/status itself.
   */
  async publish(params: {
    customerProfileId: string;
    categoryId: string;
    description: string;
    urgency: ServiceRequestUrgency;
    indicativeBudgetMin: number | null;
    indicativeBudgetMax: number | null;
    attachmentRefs: ServiceRequestAttachmentUploadRef[];
  }): Promise<ServiceRequestWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      const serviceRequest = await tx.serviceRequest.create({
        data: {
          customerProfileId: params.customerProfileId,
          categoryId: params.categoryId,
          description: params.description,
          urgency: params.urgency,
          indicativeBudgetMin: params.indicativeBudgetMin,
          indicativeBudgetMax: params.indicativeBudgetMax,
          attachments: {
            create: params.attachmentRefs.map((ref, index) => ({
              url: ref.fileUrl,
              order: index,
            })),
          },
        },
        include: SERVICE_REQUEST_INCLUDE,
      });

      if (params.attachmentRefs.length > 0) {
        await tx.serviceRequestAttachmentUploadRef.updateMany({
          where: { id: { in: params.attachmentRefs.map((ref) => ref.id) } },
          data: {
            status: ServiceRequestAttachmentUploadRefStatus.CONSUMED,
            consumedAt: new Date(),
            serviceRequestId: serviceRequest.id,
          },
        });
      }

      return serviceRequest;
    });
  }

  /**
   * `createServiceRequestForCustomer` (platform-admin, GOS-38 follow-up) —
   * an admin-initiated create, always attachment-less (no upload-ref flow
   * exists in the admin panel). Deliberately takes an EXTERNALLY-opened
   * `tx`, unlike `publish` above (which opens its own): the caller
   * (`CreateServiceRequestForCustomerService`) needs the `ServiceRequest`
   * write and its `AdminAuditLog` row to commit atomically, the same
   * "caller owns the transaction boundary, passes `tx` through to every
   * repository involved" pattern `UpdateUserAccountService`/
   * `AuditLogRepository` already establish. Selects the ADMIN row shape
   * directly (not `SERVICE_REQUEST_INCLUDE`) so the caller can map straight
   * to `AdminServiceRequestModel` without a second read.
   */
  createForAdmin(
    tx: Prisma.TransactionClient,
    params: {
      customerProfileId: string;
      categoryId: string;
      description: string;
      urgency: ServiceRequestUrgency;
      indicativeBudgetMin: number | null;
      indicativeBudgetMax: number | null;
    },
  ): Promise<AdminServiceRequestRow> {
    return tx.serviceRequest.create({
      data: {
        customerProfileId: params.customerProfileId,
        categoryId: params.categoryId,
        description: params.description,
        urgency: params.urgency,
        indicativeBudgetMin: params.indicativeBudgetMin,
        indicativeBudgetMax: params.indicativeBudgetMax,
      },
      select: ADMIN_SERVICE_REQUEST_SELECT,
    });
  }

  findById(id: string): Promise<ServiceRequestWithRelations | null> {
    return this.prisma.serviceRequest.findUnique({
      where: { id },
      include: SERVICE_REQUEST_INCLUDE,
    });
  }

  cancel(id: string): Promise<ServiceRequestWithRelations> {
    return this.prisma.serviceRequest.update({
      where: { id },
      data: { status: ServiceRequestStatus.CANCELLED, cancelledAt: new Date() },
      include: SERVICE_REQUEST_INCLUDE,
    });
  }

  findManyByCustomerProfileId(
    customerProfileId: string,
  ): Promise<ServiceRequestWithRelations[]> {
    return this.prisma.serviceRequest.findMany({
      where: { customerProfileId },
      include: SERVICE_REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Real Postgres-side filter (`WHERE status = 'OPEN' AND category_id =
   * ANY($1)`), supported by `ServiceRequest`'s `@@index([status,
   * categoryId])` — never a `findMany()` followed by an in-memory filter.
   * See the GOS-38 plan's "Performance" section.
   */
  findManyCompatible(
    categoryIds: string[],
  ): Promise<ServiceRequestWithRelations[]> {
    return this.prisma.serviceRequest.findMany({
      where: {
        status: ServiceRequestStatus.OPEN,
        categoryId: { in: categoryIds },
      },
      include: SERVICE_REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---- platform-admin `serviceRequests`/`serviceRequestDetail` (GOS-38
  // follow-up) — see the ADMIN_SERVICE_REQUEST_SELECT block above.

  findManyForAdmin(params: {
    limit: number;
    offset: number;
  }): Promise<AdminServiceRequestRow[]> {
    return this.prisma.serviceRequest.findMany({
      select: ADMIN_SERVICE_REQUEST_SELECT,
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      skip: params.offset,
    });
  }

  countAllForAdmin(): Promise<number> {
    return this.prisma.serviceRequest.count();
  }

  findByIdForAdmin(id: string): Promise<AdminServiceRequestDetailRow | null> {
    return this.prisma.serviceRequest.findUnique({
      where: { id },
      select: ADMIN_SERVICE_REQUEST_DETAIL_SELECT,
    });
  }

  /**
   * The `ServiceRequest` half of `DeleteCategoryService`'s "in use"
   * pre-check (category-tree follow-up, 2026-08-18) — the
   * `ProfessionalSpecialization` half
   * (`ProfilesRepository.countSpecializationsByCategoryId`) lives in the
   * OTHER repository that actually owns that table.
   */
  countByCategoryId(categoryId: string): Promise<number> {
    return this.prisma.serviceRequest.count({ where: { categoryId } });
  }
}
