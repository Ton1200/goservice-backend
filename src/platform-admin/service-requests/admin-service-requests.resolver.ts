import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { CurrentAdminUser } from '../admin-auth/decorators/current-admin-user.decorator';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { Category } from '../../profiles/models/category.model';
import { ListCategoriesService } from '../../profiles/services/list-categories.service';
import { AdminCreateServiceRequestInput } from './models/admin-create-service-request-input.model';
import { AdminServiceRequestCustomerModel } from './models/admin-service-request-customer.model';
import { AdminServiceRequestDetailModel } from './models/admin-service-request-detail.model';
import { AdminServiceRequestModel } from './models/admin-service-request.model';
import { AdminServiceRequestsPageModel } from './models/admin-service-requests-page.model';
import { CreateServiceRequestForCustomerService } from './services/create-service-request-for-customer.service';
import { GetAdminServiceRequestDetailService } from './services/get-admin-service-request-detail.service';
import { ListAdminServiceRequestsService } from './services/list-admin-service-requests.service';
import { ListEligibleServiceRequestCustomersService } from './services/list-eligible-service-request-customers.service';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`).
 * `serviceRequests`/`serviceRequestDetail` require `SERVICE_REQUESTS_READ`.
 * `serviceRequestCategories`/`eligibleServiceRequestCustomers`/
 * `createServiceRequestForCustomer` (the "create on behalf of a customer"
 * flow, GOS-38 follow-up, 2026-08-18) require the separate
 * `SERVICE_REQUESTS_WRITE` — a `ServiceRequest`'s lifecycle otherwise stays
 * customer-owned; this is the ONE admin-initiated write, and only creates,
 * never edits/cancels.
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminServiceRequestsResolver {
  constructor(
    private readonly listAdminServiceRequestsService: ListAdminServiceRequestsService,
    private readonly getAdminServiceRequestDetailService: GetAdminServiceRequestDetailService,
    private readonly listCategoriesService: ListCategoriesService,
    private readonly listEligibleServiceRequestCustomersService: ListEligibleServiceRequestCustomersService,
    private readonly createServiceRequestForCustomerService: CreateServiceRequestForCustomerService,
  ) {}

  @RequireAdminPermissions(Permission.SERVICE_REQUESTS_READ)
  @Query(() => AdminServiceRequestsPageModel, {
    description:
      'Lists ServiceRequests across every Customer, paginated, including which User/CustomerProfile owns each one. Phase-1 scope: limit/offset only, no server-side filter/sort arguments yet — the admin panel does client-side filtering/sorting on the fetched page.',
  })
  serviceRequests(
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ): Promise<AdminServiceRequestsPageModel> {
    return this.listAdminServiceRequestsService.listServiceRequests(
      limit,
      offset,
    );
  }

  @RequireAdminPermissions(Permission.SERVICE_REQUESTS_READ)
  @Query(() => AdminServiceRequestDetailModel, {
    description:
      'Full detail view of one ServiceRequest, including its attachments and the owning Customer. Same SERVICE_REQUESTS_READ permission as serviceRequests — no separate permission for this detail view.',
  })
  serviceRequestDetail(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<AdminServiceRequestDetailModel> {
    return this.getAdminServiceRequestDetailService.getServiceRequestDetail(id);
  }

  @RequireAdminPermissions(Permission.SERVICE_REQUESTS_WRITE)
  @Query(() => [Category], {
    description:
      'The full read-only service category catalog — reused by the "create ServiceRequest for a customer" form. Gated by SERVICE_REQUESTS_WRITE (only this flow needs it from the admin schema today), not a general-purpose admin categories query. Named distinctly from the consumer schema\'s own `categories` query (same underlying catalog, different schema/resolver) so the two never collide in the admin-schema-isolation suite\'s field-name checks.',
  })
  serviceRequestCategories(): Promise<Category[]> {
    return this.listCategoriesService.listCategories();
  }

  @RequireAdminPermissions(Permission.SERVICE_REQUESTS_WRITE)
  @Query(() => [AdminServiceRequestCustomerModel], {
    description:
      'Customers eligible to have a ServiceRequest created on their behalf — APPROVED accounts only (this project\'s "identity validated" state), optionally narrowed by a search string matching name/email. Capped at 20 rows — a typeahead picker, not a full listing. Powers createServiceRequestForCustomer\'s picker; that mutation re-validates eligibility server-side regardless of what this returns.',
  })
  eligibleServiceRequestCustomers(
    @Args('search', { type: () => String, nullable: true }) search?: string,
  ): Promise<AdminServiceRequestCustomerModel[]> {
    return this.listEligibleServiceRequestCustomersService.listEligibleCustomers(
      search,
    );
  }

  @RequireAdminPermissions(Permission.SERVICE_REQUESTS_WRITE)
  @Mutation(() => AdminServiceRequestModel, {
    description:
      'Creates a ServiceRequest on behalf of the given Customer (input.userId) — ONLY allowed when that account is APPROVED and already has a CustomerProfile, enforced server-side regardless of what eligibleServiceRequestCustomers showed. Writes an AdminAuditLog row in the same transaction. Never carries attachments.',
  })
  createServiceRequestForCustomer(
    @CurrentAdminUser() adminUserId: string,
    @Args('input') input: AdminCreateServiceRequestInput,
  ): Promise<AdminServiceRequestModel> {
    return this.createServiceRequestForCustomerService.createServiceRequestForCustomer(
      adminUserId,
      input,
    );
  }
}
