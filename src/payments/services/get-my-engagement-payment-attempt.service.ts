import { Injectable, Logger } from '@nestjs/common';
import { PaymentAttempt, PaymentAttemptStatus } from '@prisma/client';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { isSnapshotConsistentWithAttempt } from '../utils/payment-snapshot-consistency.util';
import { ApplyPaymentResultService } from './apply-payment-result.service';
import { ReadAttemptProviderStateService } from './read-attempt-provider-state.service';

/**
 * Orchestrates `Query.myEngagementPaymentAttempt` (GOS-142 — added to scope
 * by explicit human confirmation; not literally requested by the ticket) —
 * lets the Customer's own app check payment status after the wallet redirect
 * returns (or after an embedded checkout closes), independent of webhook
 * timing (a notification can take a moment to arrive, or — in a misconfigured
 * environment — never arrive at all).
 *
 * Returns the Engagement's MOST RECENT `PaymentAttempt`, whatever its method
 * or status (`PaymentAttemptRepository.findLatestByEngagementId`) — `null` if
 * none exists yet. Ownership: only the Engagement's own Customer
 * (`CardPaymentAccessService`, reused method-agnostically — see that
 * service's own header comment) — anyone else gets the SAME anti-enumeration
 * `engagementNotFound()` every other Engagement read in this module uses.
 *
 * **Opportunistic reconciliation, best-effort, for ANY digital method**: if
 * the latest attempt is still PENDING and the provider can be asked about it —
 * it already has a `providerPaymentId` (a webhook reached GoService, or the
 * synchronous card path recorded a `pending` order id) OR, since GOS-146, a
 * `providerCheckoutId` (Rapyd creates the checkout BEFORE any payment, so the
 * attempt can be re-read with no webhook and no payment id at all) — this
 * query re-reads the provider's CURRENT state right now and applies it through
 * the SAME `ApplyPaymentResultService` the webhooks use, with the SAME
 * amount/currency safety check (`isSnapshotConsistentWithAttempt`) they make
 * before ever approving money. WHICH provider API is asked is decided by
 * `attempt.method` (`ReadAttemptProviderStateService`), never by guessing from
 * the shape of an id. Any failure here (provider unreachable, misconfigured)
 * is swallowed and logged: the query NEVER fails or blocks because of it, it
 * just returns what is already in the database.
 *
 * **Documented gap, not resolved here**: a Mercado Pago attempt for which NO
 * webhook notification has ever reached GoService has no `providerPaymentId`
 * to re-read, and this query can only return what's already persisted (still
 * PENDING). Closing that fully needs a reconciliation job — explicitly out of
 * scope for GOS-142. (A Rapyd attempt does not have this gap: its checkout id
 * exists from the start.)
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
    private readonly readAttemptProviderStateService: ReadAttemptProviderStateService,
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
      (!attempt.providerPaymentId && !attempt.providerCheckoutId)
    ) {
      return attempt;
    }

    return this.reconcile(attempt, engagement.id);
  }

  private async reconcile(
    attempt: PaymentAttempt,
    engagementId: string,
  ): Promise<PaymentAttempt> {
    try {
      const billingContext =
        await this.engagementsRepository.findByIdWithBillingContext(
          engagementId,
        );
      if (!billingContext) {
        return attempt;
      }
      const state = await this.readAttemptProviderStateService.read(
        attempt,
        billingContext.customerProfile.country,
      );
      if (!state) {
        return attempt;
      }

      if (!isSnapshotConsistentWithAttempt(state, attempt)) {
        // Never approve money that doesn't reconcile — same guard the
        // provider webhooks apply.
        this.logger.error({
          event: 'my_engagement_payment_attempt_amount_mismatch',
          attemptId: attempt.id,
          expectedAmount: attempt.amount,
          expectedCurrency: attempt.currency,
          reportedAmount: state.amount,
          reportedCurrency: state.currency,
        });
        return attempt;
      }

      const resolved = await this.applyPaymentResultService.apply(attempt.id, {
        status: state.status,
        // A checkout attempt learns its payment id only once one exists.
        providerPaymentId: state.providerPaymentId ?? attempt.providerPaymentId,
        rejectionReason: state.rejectionReason,
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
