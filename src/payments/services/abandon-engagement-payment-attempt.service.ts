import { Injectable, Logger } from '@nestjs/common';
import { PaymentAttempt, PaymentAttemptStatus } from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { paymentAttemptNotAbandonable } from '../errors/payment-attempt-not-abandonable.error';
import { paymentCheckoutUnavailable } from '../errors/payment-checkout-unavailable.error';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import type { ProviderCheckoutSnapshot } from '../ports/payment-provider.port';
import { isSnapshotConsistentWithAttempt } from '../utils/payment-snapshot-consistency.util';
import { ApplyPaymentResultService } from './apply-payment-result.service';

/**
 * Orchestrates `Mutation.abandonEngagementPaymentAttempt` (GOS-146 — beyond
 * the literal ticket text, added because the design needs it): lets a Customer
 * who opened an embedded checkout and walked away FREE the Engagement's payment
 * slot, so they can pay another way (Mercado Pago, cash…). Without it, that
 * unpaid PENDING attempt — which only Rapyd's asynchronous notification would
 * ever resolve, and Rapyd sends none for a checkout nobody paid — would block
 * EVERY payment of the Engagement, whatever the provider (the partial unique
 * index covers all methods).
 *
 * Deliberately narrow and safe:
 * - only the Engagement's own Customer (anti-enumeration
 *   `engagementNotFound()` for anyone else);
 * - only the ACTIVE attempt, and only if it is a PENDING attempt of a provider
 *   with an embedded checkout — never a cash confirmation, never an APPROVED
 *   attempt, never a Mercado Pago one (those resolve through their own
 *   provider flow);
 * - **never blind**: the checkout is re-read from the provider FIRST. If the
 *   provider already created a payment inside it (paid, pending 3D Secure,
 *   failed-but-retryable…), money may have moved — the attempt is NOT
 *   abandonable (`PAYMENT_ATTEMPT_NOT_ABANDONABLE`) and, if it turns out to be
 *   PAID, that result is applied first. If the provider cannot be read, nothing
 *   changes (`PAYMENT_CHECKOUT_UNAVAILABLE`);
 * - only when the checkout has NO payment is the attempt closed, through the
 *   same guarded CAS as every other resolution — REJECTED with the generic
 *   `ABANDONED` reason (`EXP`/`DEC` checkouts keep the provider's own reason).
 *
 * **Residual risk, documented, not solvable here**: Rapyd offers no way to
 * cancel a checkout. A widget the Customer left open in another tab could
 * still be paid AFTER the attempt was closed. Mitigations: the checkout's short
 * `page_expiration` (`payments.payment-methods.rapyd.checkout-expiration-minutes`), the read-before-
 * close above, and `ApplyPaymentResultService`'s loud
 * `payment_approved_for_rejected_attempt` error log so an operator can
 * reconcile such a charge by hand.
 */
@Injectable()
export class AbandonEngagementPaymentAttemptService {
  private readonly logger = new Logger(
    AbandonEngagementPaymentAttemptService.name,
  );

  constructor(
    private readonly cardPaymentAccessService: CardPaymentAccessService,
    private readonly engagementsRepository: EngagementsRepository,
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
    private readonly applyPaymentResultService: ApplyPaymentResultService,
  ) {}

  async abandonEngagementPaymentAttempt(
    userId: string,
    engagementId: string,
  ): Promise<PaymentAttempt> {
    const engagement =
      await this.cardPaymentAccessService.resolveCustomerEngagement(
        userId,
        engagementId,
      );

    const attempt =
      await this.paymentAttemptRepository.findActiveByEngagementId(
        engagement.id,
      );
    if (
      !attempt ||
      attempt.status !== PaymentAttemptStatus.PENDING ||
      // Cash has no adapter (the registry would throw): it is never abandonable.
      !this.supportsEmbeddedCheckout(attempt)
    ) {
      throw paymentAttemptNotAbandonable();
    }
    if (!attempt.providerCheckoutId) {
      // The provider never confirmed a checkout id, so there is nothing to
      // verify — restarting (`startEngagementRapydCheckout`) repeats the create
      // and records the new checkout id.
      throw paymentAttemptNotAbandonable();
    }

    const billingContext =
      await this.engagementsRepository.findByIdWithBillingContext(
        engagement.id,
      );
    if (!billingContext) {
      throw engagementNotFound(); // a hard delete raced this call
    }

    let snapshot: ProviderCheckoutSnapshot | null;
    try {
      snapshot = await this.paymentProviderRegistry
        .embeddedCheckout(attempt.method)
        .getCheckoutSnapshot(
          attempt.providerCheckoutId,
          billingContext.customerProfile.country,
        );
    } catch (error) {
      this.logger.warn({
        event: 'payment_attempt_abandon_read_failed',
        attemptId: attempt.id,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      throw paymentCheckoutUnavailable();
    }
    if (!snapshot) {
      throw paymentCheckoutUnavailable();
    }

    if (snapshot.status === 'approved') {
      // Paid after all: record it (never discard a real payment), then refuse.
      if (isSnapshotConsistentWithAttempt(snapshot, attempt)) {
        await this.applyPaymentResultService.apply(attempt.id, {
          status: 'approved',
          providerPaymentId: snapshot.providerPaymentId,
        });
      }
      throw paymentAttemptNotAbandonable();
    }
    if (snapshot.paymentCreated) {
      // A payment exists inside the checkout (pending 3DS, failed but
      // retryable, …): the provider — not the Customer — decides its fate.
      throw paymentAttemptNotAbandonable();
    }

    const resolved = await this.applyPaymentResultService.apply(attempt.id, {
      status: 'rejected',
      providerPaymentId: null,
      // An expired/blocked checkout keeps the provider's own reason; a valid,
      // simply-unpaid one is the Customer's own choice.
      rejectionReason:
        snapshot.status === 'rejected' ? snapshot.rejectionReason : 'ABANDONED',
    });
    if (resolved?.status !== PaymentAttemptStatus.REJECTED) {
      // Lost a race (e.g. a webhook approved it between our read and our CAS).
      throw paymentAttemptNotAbandonable();
    }

    this.logger.log({
      event: 'payment_attempt_abandoned',
      attemptId: attempt.id,
      engagementId: engagement.id,
    });
    return resolved;
  }

  private supportsEmbeddedCheckout(attempt: PaymentAttempt): boolean {
    try {
      this.paymentProviderRegistry.embeddedCheckout(attempt.method);
      return true;
    } catch {
      return false;
    }
  }
}
