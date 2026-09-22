import { Injectable } from '@nestjs/common';
import { PaymentAttemptRepository } from '../../payments/payment-attempt.repository';
import { CashPaymentAccessService } from '../cash-payment-access.service';
import { CashPaymentConfirmationStateModel } from '../models/cash-payment-confirmation-state.model';
import { CashPaymentViewerRole } from '../models/cash-payment-viewer-role.enum';

/**
 * Orchestrates `Query.myCashPaymentConfirmation(engagementId)` — the
 * read-only, consumer-safe counterpart to `confirmCashPayment`. Ownership/
 * role is `CashPaymentAccessService.resolveParty`'s job (a non-party or a
 * nonexistent Engagement gets the anti-enumeration `ENGAGEMENT_NOT_FOUND`).
 * The booleans are derived from the cash `PaymentAttempt`'s own
 * `customerConfirmedAt`/`professionalConfirmedAt` columns (2026-09-18: cash
 * lives in `PaymentAttempt`, not a separate `CashPaymentConfirmation` table
 * — see that model's own schema comment); no row at all simply means nobody
 * has confirmed yet. Not gated by the Engagement's status or the cash kill
 * switch — it only reads state that already exists, same reasoning as
 * `myPendingCashCommissionDebt`.
 */
@Injectable()
export class GetMyCashPaymentConfirmationService {
  constructor(
    private readonly cashPaymentAccessService: CashPaymentAccessService,
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
  ) {}

  async getMyCashPaymentConfirmation(
    userId: string,
    engagementId: string,
  ): Promise<CashPaymentConfirmationStateModel> {
    const { role } = await this.cashPaymentAccessService.resolveParty(
      userId,
      engagementId,
    );
    const row =
      await this.paymentAttemptRepository.findCashAttemptByEngagementId(
        engagementId,
      );

    const customerConfirmed = row?.customerConfirmedAt != null;
    const professionalConfirmed = row?.professionalConfirmedAt != null;

    const model = new CashPaymentConfirmationStateModel();
    model.engagementId = engagementId;
    model.viewerRole = CashPaymentViewerRole[role];
    model.customerConfirmed = customerConfirmed;
    model.professionalConfirmed = professionalConfirmed;
    model.bothConfirmed = customerConfirmed && professionalConfirmed;
    return model;
  }
}
