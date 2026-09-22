import { Injectable, Logger } from '@nestjs/common';
import {
  EngagementStatus,
  PaymentAttempt,
  PaymentAttemptStatus,
  PaymentMethod,
} from '@prisma/client';
import { CURRENCY_BY_COUNTRY } from '../../ledger/constants/country-currency.constants';
import { RecordCashCommissionDebtService } from '../../ledger/services/record-cash-commission-debt.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { paymentMethodConflict } from '../../payments/errors/payment-method-conflict.error';
import { PaymentAttemptRepository } from '../../payments/payment-attempt.repository';
import { CashPaymentAccessService } from '../cash-payment-access.service';
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
 * 2. `PaymentAttemptRepository.upsertCashConfirmation` — creates the cash
 *    `PaymentAttempt` row if this is the first confirmation on this
 *    Engagement at all, or re-stamps the caller's own
 *    `customerConfirmedAt`/`professionalConfirmedAt` column otherwise
 *    (idempotent: confirming twice from the same role is a no-op re-stamp,
 *    never an error). Backstopped by the SAME partial unique index digital
 *    payments use, so a concurrent card charge on this Engagement makes the
 *    upsert fail with a conflict, surfaced as `PAYMENT_METHOD_CONFLICT`.
 * 3. If BOTH dates are now set and the attempt is still PENDING, the SAME
 *    guarded CAS digital payments use (`PaymentAttemptRepository.resolveIfPending`)
 *    decides which concurrent call (if any) actually gets to flip it
 *    APPROVED and write the one `CASH_COMMISSION_DEBT` `LedgerEntry`, via
 *    `RecordCashCommissionDebtService` — see that service's own header
 *    comment. A lost race means another call already recorded it; this call
 *    still succeeds and returns the (already APPROVED) row.
 *
 * **Cash lives in `PaymentAttempt` together with every other method**
 * (2026-09-18 product decision, generalized from the original, cash-only
 * `CashPaymentConfirmation` table) — see that model's own schema comment.
 *
 * Allowed ONLY while the Engagement is `IN_PROGRESS`,
 * `PENDING_CUSTOMER_CONFIRMATION`, or `COMPLETED` — see
 * `engagementNotConfirmableForCashPayment()`'s own header comment for why
 * this is a documented ASSUMPTION, not a ticket-specified rule. Also
 * rejected if the Engagement already picked the OTHER method
 * (any `paymentMethod` other than CASH — Mercado Pago or Rapyd) — same symmetric check
 * `PayEngagementWithCardService` runs for the reverse case.
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
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
    private readonly recordCashCommissionDebtService: RecordCashCommissionDebtService,
  ) {}

  async confirmCashPayment(
    userId: string,
    engagementId: string,
  ): Promise<PaymentAttempt> {
    const { role, engagement } =
      await this.cashPaymentAccessService.resolveParty(userId, engagementId);

    if (
      engagement.status !== EngagementStatus.IN_PROGRESS &&
      engagement.status !== EngagementStatus.PENDING_CUSTOMER_CONFIRMATION &&
      engagement.status !== EngagementStatus.COMPLETED
    ) {
      throw engagementNotConfirmableForCashPayment();
    }
    // GOS-146: any digital provider (Mercado Pago, Rapyd, …) — not just one —
    // has already committed the Engagement to a non-cash method.
    if (
      engagement.paymentMethod !== null &&
      engagement.paymentMethod !== PaymentMethod.CASH
    ) {
      throw paymentMethodConflict();
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

    const attempt = await this.prisma.$transaction(async (tx) => {
      await this.engagementsRepository.setPaymentMethodIfUnset(
        tx,
        engagementId,
        PaymentMethod.CASH,
      );

      const row = await this.paymentAttemptRepository.upsertCashConfirmation(
        tx,
        { engagementId, amount: quotedPrice, currency, role },
      );
      if (!row) {
        // The active slot is already taken by a digital attempt that landed
        // between our precheck and this transaction — see
        // `upsertCashConfirmation`'s own header comment.
        throw paymentMethodConflict();
      }

      if (
        row.customerConfirmedAt &&
        row.professionalConfirmedAt &&
        row.status === PaymentAttemptStatus.PENDING
      ) {
        const cas = await this.paymentAttemptRepository.resolveIfPending(
          tx,
          row.id,
          {
            status: 'APPROVED',
            providerPaymentId: null,
            rejectionReason: null,
          },
        );
        if (cas.count === 1) {
          await this.recordCashCommissionDebtService.recordCommissionDebt(tx, {
            engagementId,
            quotedPrice,
            currency,
            customerProfileId: engagement.customerProfileId,
            professionalProfileId: engagement.professionalProfileId,
          });
          row.status = PaymentAttemptStatus.APPROVED;
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

    return attempt;
  }
}
