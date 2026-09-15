import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { AdminCashPaymentConfirmationsFilterInput } from './models/admin-cash-payment-confirmations-filter-input.model';
import { AdminCashPaymentConfirmationsPageModel } from './models/admin-cash-payment-confirmations-page.model';
import { ListAdminCashPaymentConfirmationsService } from './services/list-admin-cash-payment-confirmations.service';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`).
 * `adminCashPaymentConfirmations` requires `Permission.CASH_PAYMENTS_READ` —
 * its own dedicated permission (NOT `LEDGER_READ` — see the `Permission`
 * enum's own comment in `prisma/schema.prisma`).
 *
 * No module-enabled kill switch — auditing existing `CashPaymentConfirmation`
 * history is always available to a holder of `CASH_PAYMENTS_READ`, same
 * "an admin's ability to audit existing history shouldn't disappear just
 * because the client-facing capability was toggled off" reasoning
 * `AdminLedgerResolver`/`AppointmentsModuleEnabledGuard`'s own admin-surface
 * carve-out already establish.
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminCashPaymentResolver {
  constructor(
    private readonly listAdminCashPaymentConfirmationsService: ListAdminCashPaymentConfirmationsService,
  ) {}

  @RequireAdminPermissions(Permission.CASH_PAYMENTS_READ)
  @Query(() => AdminCashPaymentConfirmationsPageModel, {
    description:
      'Lists every CashPaymentConfirmation, paginated, optionally filtered by engagementId/onlyPending (only rows where at most one party has confirmed so far) — visibility into half-confirmed cash-payment cases adminLedgerEntries alone cannot show (GOS-87).',
  })
  adminCashPaymentConfirmations(
    @Args('filter', { nullable: true })
    filter?: AdminCashPaymentConfirmationsFilterInput,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ): Promise<AdminCashPaymentConfirmationsPageModel> {
    return this.listAdminCashPaymentConfirmationsService.listCashPaymentConfirmations(
      filter,
      limit,
      offset,
    );
  }
}
