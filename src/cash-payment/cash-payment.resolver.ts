import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { WalletBalanceModel } from '../ledger/models/wallet-balance.model';
import { GetMyPaymentBalanceService } from '../ledger/services/get-my-payment-balance.service';
import { GetMyWalletBalancesService } from '../ledger/services/get-my-wallet-balances.service';
import { CashPaymentModuleEnabledGuard } from './guards/cash-payment-module-enabled.guard';
import { CashPaymentConfirmationStateModel } from './models/cash-payment-confirmation-state.model';
import { CashPaymentConfirmationModel } from './models/cash-payment-confirmation.model';
import { toCashPaymentConfirmationModel } from './models/to-cash-payment-confirmation-model.util';
import { ConfirmCashPaymentService } from './services/confirm-cash-payment.service';
import { GetMyCashPaymentConfirmationService } from './services/get-my-cash-payment-confirmation.service';
import { GetMyPendingCashCommissionDebtService } from './services/get-my-pending-cash-commission-debt.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `AppointmentsResolver`. `confirmCashPayment` requires `SessionGuard` +
 * `AccountApprovedGuard` + `CashPaymentModuleEnabledGuard`, in that exact
 * order. `myPendingCashCommissionDebt` and `myCashPaymentConfirmation`
 * deliberately do NOT get the module-enabled guard — see that guard's own header comment. Neither
 * operation accepts `customerProfileId`/`professionalProfileId`/`userId` as
 * an argument — ownership/role is always derived server-side.
 */
@Resolver()
export class CashPaymentResolver {
  constructor(
    private readonly confirmCashPaymentService: ConfirmCashPaymentService,
    private readonly getMyPendingCashCommissionDebtService: GetMyPendingCashCommissionDebtService,
    private readonly getMyCashPaymentConfirmationService: GetMyCashPaymentConfirmationService,
    private readonly getMyPaymentBalanceService: GetMyPaymentBalanceService,
    private readonly getMyWalletBalancesService: GetMyWalletBalancesService,
  ) {}

  @UseGuards(SessionGuard, AccountApprovedGuard, CashPaymentModuleEnabledGuard)
  @Mutation(() => CashPaymentConfirmationModel, {
    description:
      "Confirms that the Customer paid the Professional in cash for this Engagement, outside GoService. Either party may call this — the FIRST call from either side assigns Engagement.paymentMethod = CASH (idempotent: it never overwrites an already-assigned method); calling it again from the same role just re-stamps that role's own confirmation timestamp, never an error. Only once BOTH parties have confirmed is the platform's CASH_COMMISSION_DEBT LedgerEntry recorded. Allowed only while the Engagement is IN_PROGRESS, PENDING_CUSTOMER_CONFIRMATION, or COMPLETED.",
  })
  async confirmCashPayment(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<CashPaymentConfirmationModel> {
    const attempt = await this.confirmCashPaymentService.confirmCashPayment(
      userId,
      engagementId,
    );
    return toCashPaymentConfirmationModel(attempt);
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

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => CashPaymentConfirmationStateModel, {
    description:
      "The double-confirmation state of ONE Engagement's cash payment — the authoritative, persisted read counterpart to confirmCashPayment. customerConfirmed/professionalConfirmed/bothConfirmed are all false until someone confirms; viewerRole says which side the caller is on this Engagement. Only the Engagement's own Customer or Professional may read it — anyone else (or a nonexistent Engagement) gets ENGAGEMENT_NOT_FOUND (anti-enumeration). Not gated by the Cash Payment kill switch or the Engagement's status — it only reads existing state.",
  })
  myCashPaymentConfirmation(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<CashPaymentConfirmationStateModel> {
    return this.getMyCashPaymentConfirmationService.getMyCashPaymentConfirmation(
      userId,
      engagementId,
    );
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => Int, {
    description:
      "The authenticated Professional's current payment balance, across every payment method: net digital credits minus cash commission debt. Available immediately (2026-09-18 product decision — no provider-settlement holdback is reflected here), computed fresh on every read. Can be negative.",
    deprecationReason:
      'Carries no currency and adds rows of different currencies together. Use myWalletBalances.',
  })
  myPaymentBalance(@CurrentUser() userId: string): Promise<number> {
    return this.getMyPaymentBalanceService.getMyPaymentBalance(userId);
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => [WalletBalanceModel], {
    description:
      "The authenticated Professional's wallet, one row per currency. Usually a single row; more than one only if they hold movements in several currencies, which are never added together. With no movements yet, one zero row in the currency of the Professional's country. Takes no arguments.",
  })
  myWalletBalances(
    @CurrentUser() userId: string,
  ): Promise<WalletBalanceModel[]> {
    return this.getMyWalletBalancesService.getMyWalletBalances(userId);
  }
}
