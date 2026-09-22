import { Injectable, Logger } from '@nestjs/common';
import { PaymentAttempt, PaymentAttemptStatus } from '@prisma/client';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { PaymentProviderPort } from '../ports/payment-provider.port';
import { ApplyPaymentResultService } from './apply-payment-result.service';

// A provider payment id is purely numeric (the legacy Payments API — wallet
// flow); an order id is not (the Orders API — card flow, `ORD…`). Same
// distinction `PAYMENT_ID_PATTERN` makes inside `MercadoPagoPaymentAdapter`
// (not imported from there — this stays a small, self-contained check rather
// than reaching into the adapter's private constants).
const NUMERIC_PROVIDER_ID_PATTERN = /^\d+$/;

/**
 * Orchestrates `Query.myEngagementPaymentAttempt` (GOS-142 — added to scope
 * by explicit human confirmation; not literally requested by the ticket) —
 * lets the Customer's own app check payment status after the wallet redirect
 * returns, independent of webhook timing (a notification can take a moment
 * to arrive, or — in a misconfigured environment — never arrive at all).
 *
 * Returns the Engagement's MOST RECENT `PaymentAttempt`, whatever its method
 * or status (`PaymentAttemptRepository.findLatestByEngagementId`) — `null` if
 * none exists yet. Ownership: only the Engagement's own Customer
 * (`CardPaymentAccessService`, reused method-agnostically — see that
 * service's own header comment) — anyone else gets the SAME anti-enumeration
 * `engagementNotFound()` every other Engagement read in this module uses.
 *
 * **Opportunistic reconciliation, best-effort, for EITHER digital method**:
 * if the latest attempt is still PENDING and already has a
 * `providerPaymentId` (i.e. at least one webhook notification already
 * reached GoService, or the synchronous card path recorded a `pending` order
 * id), this query re-reads the provider's CURRENT state right now — via
 * `getPaymentByPaymentId` for a wallet attempt's numeric id, or `getPayment`
 * for a card attempt's order id — and applies it through the SAME
 * `ApplyPaymentResultService` the webhook uses, with the SAME
 * amount/currency safety check `HandleMercadoPagoNotificationService` makes
 * before ever approving money. Any failure here (provider unreachable,
 * misconfigured) is swallowed and logged: the query NEVER fails or blocks
 * because of it, it just returns what is already in the database.
 *
 * **Documented gap, not resolved here**: if NO webhook notification has ever
 * reached GoService, there is no `providerPaymentId` to re-read, and this
 * query can only return what's already persisted (still PENDING). Closing
 * that fully needs a reconciliation job — explicitly out of scope for
 * GOS-142 (see the plan).
 */
@Injectable()
export class GetMyEngagementPaymentAttemptService {
  private readonly logger = new Logger(
    GetMyEngagementPaymentAttemptService.name,
  );

  constructor(
    private readonly cardPaymentAccessService: CardPaymentAccessService,
    private readonly engagementsRepository: EngagementsRepository,
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
    private readonly paymentProvider: PaymentProviderPort,
    private readonly applyPaymentResultService: ApplyPaymentResultService,
  ) {}

  async getMyEngagementPaymentAttempt(
    userId: string,
    engagementId: string,
  ): Promise<PaymentAttempt | null> {
    const engagement =
      await this.cardPaymentAccessService.resolveCustomerEngagement(
        userId,
        engagementId,
      );

    const attempt =
      await this.paymentAttemptRepository.findLatestByEngagementId(
        engagement.id,
      );
    if (!attempt) {
      return null;
    }
    if (
      attempt.status !== PaymentAttemptStatus.PENDING ||
      !attempt.providerPaymentId
    ) {
      return attempt;
    }

    return this.reconcile(attempt, engagement.id);
  }

  private async reconcile(
    attempt: PaymentAttempt,
    engagementId: string,
  ): Promise<PaymentAttempt> {
    const providerPaymentId = attempt.providerPaymentId;
    if (!providerPaymentId) {
      return attempt; // narrows for TS — already checked by the caller
    }
    try {
      const billingContext =
        await this.engagementsRepository.findByIdWithBillingContext(
          engagementId,
        );
      if (!billingContext) {
        return attempt;
      }
      const country = billingContext.customerProfile.country;
      const snapshot = NUMERIC_PROVIDER_ID_PATTERN.test(providerPaymentId)
        ? await this.paymentProvider.getPaymentByPaymentId(
            providerPaymentId,
            country,
          )
        : await this.paymentProvider.getPayment(providerPaymentId, country);
      if (!snapshot) {
        return attempt;
      }

      if (
        snapshot.status === 'approved' &&
        (snapshot.amount !== attempt.amount ||
          snapshot.currency?.toUpperCase() !== attempt.currency.toUpperCase())
      ) {
        // Never approve money that doesn't reconcile — same guard
        // `HandleMercadoPagoNotificationService` applies.
        this.logger.error({
          event: 'my_engagement_payment_attempt_amount_mismatch',
          attemptId: attempt.id,
          expectedAmount: attempt.amount,
          expectedCurrency: attempt.currency,
          reportedAmount: snapshot.amount,
          reportedCurrency: snapshot.currency,
        });
        return attempt;
      }

      const resolved = await this.applyPaymentResultService.apply(attempt.id, {
        status: snapshot.status,
        providerPaymentId,
        rejectionReason: snapshot.rejectionReason,
      });
      return resolved ?? attempt;
    } catch (error) {
      this.logger.warn({
        event: 'my_engagement_payment_attempt_reconciliation_failed',
        attemptId: attempt.id,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return attempt;
    }
  }
}
