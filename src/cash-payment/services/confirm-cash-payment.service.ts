import { Injectable, Logger } from '@nestjs/common';
import {
  CashPaymentConfirmation,
  EngagementStatus,
  PaymentMethod,
} from '@prisma/client';
import { CURRENCY_BY_COUNTRY } from '../../ledger/constants/country-currency.constants';
import { RecordCashCommissionDebtService } from '../../ledger/services/record-cash-commission-debt.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { CashPaymentAccessService } from '../cash-payment-access.service';
import { CashPaymentRepository } from '../cash-payment.repository';
import { engagementNotConfirmableForCashPayment } from '../errors/engagement-not-confirmable-for-cash-payment.error';

/**
 * Orchestrates `Mutation.confirmCashPayment` (GOS-87) — either party of an
 * Engagement confirms that the Customer paid the Professional in cash,
 * outside GoService. The FIRST call from either party, inside ONE
 * transaction:
 *
 * 1. `EngagementsRepository.setPaymentMethodIfUnset` — assigns
 *    `Engagement.paymentMethod = CASH` if no method was assigned yet
 *    (idempotent no-op otherwise; there is no separate "select a payment
 *    method" mutation — confirming cash IS how a job's method becomes CASH).
 * 2. `CashPaymentRepository.upsertConfirmation` — creates the
 *    `CashPaymentConfirmation` row if this is the first confirmation on this
 *    Engagement at all, or re-stamps the caller's own
 *    `customerConfirmedAt`/`professionalConfirmedAt` column otherwise
 *    (idempotent: confirming twice from the same role is a no-op re-stamp,
 *    never an error).
 * 3. If BOTH dates are now set and the debt hasn't been recorded yet, a
 *    guarded CAS (`CashPaymentRepository.markCommissionDebtRecordedIfUnset`)
 *    decides which concurrent call (if any) actually gets to write the one
 *    `CASH_COMMISSION_DEBT` `LedgerEntry`, via
 *    `RecordCashCommissionDebtService` — see that service's own header
 *    comment. A lost race means another call already recorded it; this call
 *    still succeeds and returns the (already-fully-confirmed) row.
 *
 * Allowed ONLY while the Engagement is `IN_PROGRESS`,
 * `PENDING_CUSTOMER_CONFIRMATION`, or `COMPLETED` — see
 * `engagementNotConfirmableForCashPayment()`'s own header comment for why
 * this is a documented ASSUMPTION, not a ticket-specified rule.
 *
 * Ownership/role resolution is entirely `CashPaymentAccessService`'s job —
 * a non-party (or a nonexistent Engagement) gets the anti-enumeration
 * `engagementNotFound()`, never reaching this service's own checks.
 */
@Injectable()
export class ConfirmCashPaymentService {
  private readonly logger = new Logger(ConfirmCashPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashPaymentAccessService: CashPaymentAccessService,
    private readonly engagementsRepository: EngagementsRepository,
    private readonly cashPaymentRepository: CashPaymentRepository,
    private readonly recordCashCommissionDebtService: RecordCashCommissionDebtService,
  ) {}

  async confirmCashPayment(
    userId: string,
    engagementId: string,
  ): Promise<CashPaymentConfirmation> {
    const { role, engagement } =
      await this.cashPaymentAccessService.resolveParty(userId, engagementId);

    if (
      engagement.status !== EngagementStatus.IN_PROGRESS &&
      engagement.status !== EngagementStatus.PENDING_CUSTOMER_CONFIRMATION &&
      engagement.status !== EngagementStatus.COMPLETED
    ) {
      throw engagementNotConfirmableForCashPayment();
    }

    // Billing context, captured up front — same "read before the
    // transaction opens" idiom `CancelEngagementByCustomerService` already
    // establishes. Needed only if THIS call turns out to be the one that
    // completes both confirmations, but cheap and immutable to read
    // regardless (Quote.price/negotiatedPrice and CustomerProfile.country
    // never change once an Engagement exists).
    const billingContext =
      await this.engagementsRepository.findByIdWithBillingContext(engagementId);
    if (!billingContext) {
      // Already resolved to exist by resolveParty above — a lost row here
      // would mean a hard-delete raced this call, same anti-enumeration
      // posture every other Engagement-billing read in this codebase takes.
      throw engagementNotFound();
    }
    const quotedPrice =
      billingContext.quote.negotiatedPrice ?? billingContext.quote.price;
    const currency =
      CURRENCY_BY_COUNTRY[billingContext.customerProfile.country];

    const confirmation = await this.prisma.$transaction(async (tx) => {
      await this.engagementsRepository.setPaymentMethodIfUnset(
        tx,
        engagementId,
        PaymentMethod.CASH,
      );

      const row = await this.cashPaymentRepository.upsertConfirmation(
        tx,
        engagementId,
        role,
      );

      if (
        row.customerConfirmedAt &&
        row.professionalConfirmedAt &&
        !row.commissionDebtRecorded
      ) {
        const cas =
          await this.cashPaymentRepository.markCommissionDebtRecordedIfUnset(
            tx,
            engagementId,
          );
        if (cas.count === 1) {
          await this.recordCashCommissionDebtService.recordCommissionDebt(tx, {
            engagementId,
            quotedPrice,
            currency,
            customerProfileId: engagement.customerProfileId,
            professionalProfileId: engagement.professionalProfileId,
          });
          row.commissionDebtRecorded = true;
        }
      }

      return row;
    });

    this.logger.log({
      event: 'cash_payment_confirmed',
      outcome: 'success',
      engagementId,
      role,
    });

    return confirmation;
  }
}
