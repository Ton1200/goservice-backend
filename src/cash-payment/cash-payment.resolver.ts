import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { CashPaymentModuleEnabledGuard } from './guards/cash-payment-module-enabled.guard';
import { CashPaymentConfirmationModel } from './models/cash-payment-confirmation.model';
import { ConfirmCashPaymentService } from './services/confirm-cash-payment.service';
import { GetMyPendingCashCommissionDebtService } from './services/get-my-pending-cash-commission-debt.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `AppointmentsResolver`. `confirmCashPayment` requires `SessionGuard` +
 * `AccountApprovedGuard` + `CashPaymentModuleEnabledGuard`, in that exact
 * order. `myPendingCashCommissionDebt` deliberately does NOT get the
 * module-enabled guard — see that guard's own header comment. Neither
 * operation accepts `customerProfileId`/`professionalProfileId`/`userId` as
 * an argument — ownership/role is always derived server-side.
 */
@Resolver()
export class CashPaymentResolver {
  constructor(
    private readonly confirmCashPaymentService: ConfirmCashPaymentService,
    private readonly getMyPendingCashCommissionDebtService: GetMyPendingCashCommissionDebtService,
  ) {}

  @UseGuards(SessionGuard, AccountApprovedGuard, CashPaymentModuleEnabledGuard)
  @Mutation(() => CashPaymentConfirmationModel, {
    description:
      "Confirms that the Customer paid the Professional in cash for this Engagement, outside GoService. Either party may call this — the FIRST call from either side assigns Engagement.paymentMethod = CASH (idempotent: it never overwrites an already-assigned method); calling it again from the same role just re-stamps that role's own confirmation timestamp, never an error. Only once BOTH parties have confirmed is the platform's CASH_COMMISSION_DEBT LedgerEntry recorded. Allowed only while the Engagement is IN_PROGRESS, PENDING_CUSTOMER_CONFIRMATION, or COMPLETED.",
  })
  confirmCashPayment(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<CashPaymentConfirmationModel> {
    return this.confirmCashPaymentService.confirmCashPayment(
      userId,
      engagementId,
    );
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => Int, {
    description:
      "The authenticated Professional's total pending cash-payment commission debt — the sum of every CASH_COMMISSION_DEBT LedgerEntry ever written for them. Always derived from the session — takes no arguments. Sums ALL entries today; there is no 'regularize'/automatic-discount-on-next-digital-charge mechanism yet (depends on GOS-79).",
  })
  myPendingCashCommissionDebt(@CurrentUser() userId: string): Promise<number> {
    return this.getMyPendingCashCommissionDebtService.getMyPendingCashCommissionDebt(
      userId,
    );
  }
}
