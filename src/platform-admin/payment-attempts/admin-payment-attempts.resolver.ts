import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { AdminPaymentAttemptsFilterInput } from './models/admin-payment-attempts-filter-input.model';
import { AdminPaymentAttemptsPageModel } from './models/admin-payment-attempts-page.model';
import { ListAdminPaymentAttemptsService } from './services/list-admin-payment-attempts.service';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`).
 * `adminPaymentAttempts` requires `Permission.CASH_PAYMENTS_READ` — the SAME
 * permission `adminCashPaymentConfirmations` used before this query replaced
 * it (2026-09-18: cash lives in `PaymentAttempt` together with every other
 * method — see that model's own schema comment). Kept the existing
 * permission name rather than renaming it: renaming a `Permission` enum
 * value means an extra migration and touches every admin role that already
 * holds it, for a label-only change; its scope simply broadened from
 * "cash payments" to "payment attempts of any method". Revisit if a
 * narrower per-method permission is ever needed.
 *
 * No module-enabled kill switch — auditing existing `PaymentAttempt`
 * history is always available to a holder of `CASH_PAYMENTS_READ`, same
 * "an admin's ability to audit existing history shouldn't disappear just
 * because the client-facing capability was toggled off" reasoning
 * `AdminLedgerResolver`/`AppointmentsModuleEnabledGuard`'s own admin-surface
 * carve-out already establish.
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminPaymentAttemptsResolver {
  constructor(
    private readonly listAdminPaymentAttemptsService: ListAdminPaymentAttemptsService,
  ) {}

  @RequireAdminPermissions(Permission.CASH_PAYMENTS_READ)
  @Query(() => AdminPaymentAttemptsPageModel, {
    description:
      'Lists every PaymentAttempt, paginated, of any method (cash or digital), optionally filtered by engagementId/onlyPending (only PENDING or REJECTED attempts — the in-flight/failed cases adminEngagementPaymentSummaries alone cannot show, since it only reflects settled events that have ledger entries). Replaces the cash-only adminCashPaymentConfirmations.',
  })
  adminPaymentAttempts(
    @Args('filter', { nullable: true })
    filter?: AdminPaymentAttemptsFilterInput,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ): Promise<AdminPaymentAttemptsPageModel> {
    return this.listAdminPaymentAttemptsService.listPaymentAttempts(
      filter,
      limit,
      offset,
    );
  }
}
