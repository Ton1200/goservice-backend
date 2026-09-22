import { Injectable, Logger } from '@nestjs/common';
import {
  CountryCode,
  EngagementStatus,
  PaymentAttempt,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { CURRENCY_BY_COUNTRY } from '../../ledger/constants/country-currency.constants';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { cardPaymentAlreadyInProgress } from '../errors/card-payment-already-in-progress.error';
import { engagementNotPayableByCard } from '../errors/engagement-not-payable-by-card.error';
import { paymentCheckoutUnavailable } from '../errors/payment-checkout-unavailable.error';
import { paymentMethodConflict } from '../errors/payment-method-conflict.error';
import { paymentProviderNotConfigured } from '../errors/payment-provider-not-configured.error';
import { paymentProviderUnavailable } from '../errors/payment-provider-unavailable.error';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { PAYMENT_METHOD_SETTING_KEYS } from '../constants/payments-setting-keys.constants';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import {
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
  type CheckoutResult,
  type ProviderCheckoutSnapshot,
} from '../ports/payment-provider.port';
import { isSnapshotConsistentWithAttempt } from '../utils/payment-snapshot-consistency.util';
import { ApplyPaymentResultService } from './apply-payment-result.service';
import { RapydSavedCardsCustomerService } from './rapyd-saved-cards-customer.service';

export interface StartEngagementRapydCheckoutInput {
  engagementId: string;
}

export interface StartEngagementRapydCheckoutResult {
  attempt: PaymentAttempt;
  checkoutId: string;
  toolkitScriptUrl: string;
}

interface BillingFacts {
  country: CountryCode;
  amount: number;
  currency: string;
  /**
   * The Rapyd customer to link the checkout to — set only while saved cards are
   * on, and it is what makes Rapyd's widget offer "Save card for future payments".
   */
  providerCustomerId?: string;
}

/**
 * Orchestrates `Mutation.startEngagementRapydCheckout` (GOS-146) — a Customer
 * pays an Engagement by card through Rapyd's embedded Checkout Toolkit, with NO
 * redirect (the card is typed into Rapyd's own iframe; GoService only ever
 * sees a checkout id — PCI SAQ-A). Mirrors `PayEngagementWithCardService`'s
 * ownership/precondition/attempt-creation shape (same access check, same
 * status window, same partial-unique-index race handling) but its OUTCOME is
 * like the wallet's, not the card token's: a checkout never resolves in the
 * same request — the payment happens later, inside the widget, and reaches
 * GoService through Rapyd's webhook (or `myEngagementPaymentAttempt`'s
 * re-read). So this service NEVER approves anything; the attempt it returns is
 * PENDING. The widget's own client-side events are NOT a source of truth.
 *
 * 1. Ownership: only the Engagement's Customer (`CardPaymentAccessService`).
 * 2. Preconditions: status `IN_PROGRESS | PENDING_CUSTOMER_CONFIRMATION |
 *    COMPLETED` and payment method not fixed to CASH — same as the card.
 * 3. Amount/currency/country derived server-side, exactly like the ledger:
 *    `quote.negotiatedPrice ?? quote.price`, `CURRENCY_BY_COUNTRY[country]`.
 * 4. The `PaymentAttempt(method: RAPYD, PENDING)` is inserted in its own short
 *    statement BEFORE Rapyd is called (no DB transaction is held across an
 *    HTTP call); the partial unique index makes a second active attempt
 *    impossible, across providers.
 * 5. `createCheckout` (the attempt id is sent as the idempotency key — which
 *    Rapyd does NOT honor for checkouts, verified live), then the checkout id
 *    is recorded on the attempt.
 *
 * **The abandoned attempt** (the reason this service is more than "create and
 * return"): opening the widget and closing it without paying leaves a PENDING
 * attempt that would block EVERY payment of the Engagement, Mercado Pago
 * included. So when the Engagement already has an active Rapyd attempt, it is
 * re-read from Rapyd FIRST (never decided from local state):
 * - already paid → the result is applied and the caller gets the "already
 *   paid" conflict (nothing new is created);
 * - still unpaid and valid → the SAME checkout id is returned (idempotent);
 * - expired / blocked (`rejected`) → the attempt is closed as REJECTED and a
 *   NEW one is created;
 * - no checkout id yet (the create call timed out earlier) → the create call
 *   is repeated. Rapyd does NOT dedupe it (verified live 2026-09-21: the same
 *   idempotency key created a second checkout), so the checkout the timed-out
 *   call may have made is orphaned: if it is ever paid GoService cannot match
 *   it to this attempt (`rapyd_payment_for_other_checkout` is logged for manual
 *   reconciliation). Rare — it needs a create that timed out AND a widget opened
 *   on it — and bounded by the checkout's short `page_expiration`.
 * The Customer can also drop an unpaid attempt to switch provider
 * (`AbandonEngagementPaymentAttemptService`).
 *
 * **Saved cards (GOS-146)**: while `payments.payment-methods.rapyd.saved-cards-enabled`
 * is ON the checkout is created linked to the Customer's Rapyd customer (created
 * on first use), which makes the widget offer an unticked "Save card for future
 * payments" box. That link is BEST-EFFORT: if the Rapyd customer cannot be
 * created the checkout is created WITHOUT it — the payment is never blocked
 * for an add-on. A checkout resumed (same id) keeps whatever it was created with.
 * **The checkout is linked ONLY while the Customer's Rapyd vault is EMPTY.**
 * Verified live (GOS-146, 2026-09-21): once a checkout is linked to a customer
 * that already has a stored card, the widget opens on "Pay with your card •••• 1111"
 * — and paying through that view FAILS in this Rapyd account
 * (`ERROR_CREATE_HOSTED_PAGE_PAYMENT`, HTTP 400), with the plain card form one
 * click away ("Use a different card"). So a Customer who already has a saved card
 * gets the plain card form here (an unlinked checkout); a saved card is charged
 * with `payEngagementWithSavedCard` instead. Consequence: one saved card per
 * Customer through the widget — to change it, delete it and pay again.
 *
 * Failure handling, same philosophy as the card: provider not configured →
 * attempt REJECTED (`PROVIDER_ERROR`) and
 * `PAYMENT_PROVIDER_NOT_CONFIGURED`; Rapyd refuses the request →
 * REJECTED; outcome UNKNOWN (timeout/5xx) → the attempt is deliberately left
 * PENDING (a checkout may exist) and `PAYMENT_PROVIDER_UNAVAILABLE` is thrown —
 * a retry repeats the create (see the orphan-checkout note above).
 */
@Injectable()
export class StartEngagementRapydCheckoutService {
  private readonly logger = new Logger(
    StartEngagementRapydCheckoutService.name,
  );

  constructor(
    private readonly cardPaymentAccessService: CardPaymentAccessService,
    private readonly engagementsRepository: EngagementsRepository,
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
    private readonly applyPaymentResultService: ApplyPaymentResultService,
    private readonly platformSettingPort: PlatformSettingPort,
    private readonly profilesRepository: ProfilesRepository,
    private readonly savedCardsCustomerService: RapydSavedCardsCustomerService,
  ) {}

  async startEngagementRapydCheckout(
    userId: string,
    input: StartEngagementRapydCheckoutInput,
  ): Promise<StartEngagementRapydCheckoutResult> {
    const engagement =
      await this.cardPaymentAccessService.resolveCustomerEngagement(
        userId,
        input.engagementId,
      );

    if (
      (engagement.status !== EngagementStatus.IN_PROGRESS &&
        engagement.status !== EngagementStatus.PENDING_CUSTOMER_CONFIRMATION &&
        engagement.status !== EngagementStatus.COMPLETED) ||
      engagement.paymentMethod === PaymentMethod.CASH
    ) {
      throw engagementNotPayableByCard();
    }

    const billingContext =
      await this.engagementsRepository.findByIdWithBillingContext(
        engagement.id,
      );
    if (!billingContext) {
      // Resolved to exist a moment ago — a hard delete raced this call.
      throw engagementNotFound();
    }
    const billing: BillingFacts = {
      country: billingContext.customerProfile.country,
      amount:
        billingContext.quote.negotiatedPrice ?? billingContext.quote.price,
      currency: CURRENCY_BY_COUNTRY[billingContext.customerProfile.country],
      providerCustomerId: await this.resolveSavedCardsCustomerId(userId),
    };

    // Resolved BEFORE any attempt is inserted: a registry wiring error must
    // never leave a PENDING attempt behind.
    this.paymentProviderRegistry.embeddedCheckout(PaymentMethod.RAPYD);

    const active = await this.paymentAttemptRepository.findActiveByEngagementId(
      engagement.id,
    );
    if (active) {
      if (active.method === PaymentMethod.CASH) {
        throw paymentMethodConflict();
      }
      if (active.method !== PaymentMethod.RAPYD) {
        // Another provider holds the slot (PENDING or already paid).
        throw cardPaymentAlreadyInProgress();
      }
      return this.resumeActiveAttempt(active, engagement.id, billing);
    }

    return this.startNewAttempt(engagement.id, billing);
  }

  /**
   * The Rapyd customer id to link a new checkout to, or `undefined` when saved
   * cards are off or the customer could not be prepared (never fatal).
   */
  private async resolveSavedCardsCustomerId(
    userId: string,
  ): Promise<string | undefined> {
    if (
      !(await this.platformSettingPort.isEnabled(
        PAYMENT_METHOD_SETTING_KEYS.rapyd.savedCardsEnabled,
      ))
    ) {
      return undefined;
    }
    try {
      const profile =
        await this.profilesRepository.findCustomerProfileByUserId(userId);
      if (!profile) {
        return undefined;
      }
      const { providerCustomerId } =
        await this.savedCardsCustomerService.ensure(profile, userId);
      const vault = await this.paymentProviderRegistry
        .savedCards(PaymentMethod.RAPYD)
        .listSavedCards(providerCustomerId);
      if (vault.length > 0) {
        this.logger.log({
          event: 'rapyd_checkout_not_linked_customer_has_saved_card',
          customerProfileId: profile.id,
        });
        return undefined;
      }
      return providerCustomerId;
    } catch (error) {
      this.logger.warn({
        event: 'rapyd_saved_cards_customer_unavailable',
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return undefined;
    }
  }

  /** The active attempt is Rapyd's own (PENDING or APPROVED). See the class comment. */
  private async resumeActiveAttempt(
    attempt: PaymentAttempt,
    engagementId: string,
    billing: BillingFacts,
  ): Promise<StartEngagementRapydCheckoutResult> {
    if (attempt.status !== 'PENDING') {
      // APPROVED — already paid.
      throw cardPaymentAlreadyInProgress();
    }

    const provider = this.paymentProviderRegistry.embeddedCheckout(
      PaymentMethod.RAPYD,
    );

    if (!attempt.providerCheckoutId) {
      // The earlier create call never answered — repeat it. Rapyd does not
      // dedupe by idempotency key (verified live), so this may orphan the
      // checkout the first call created; see the class comment.
      return this.createCheckoutFor(attempt, engagementId, billing);
    }

    let snapshot: ProviderCheckoutSnapshot | null;
    try {
      snapshot = await provider.getCheckoutSnapshot(
        attempt.providerCheckoutId,
        billing.country,
      );
    } catch (error) {
      this.logger.warn({
        event: 'rapyd_checkout_resume_read_failed',
        attemptId: attempt.id,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      throw error instanceof PaymentProviderNotConfiguredError
        ? paymentProviderNotConfigured()
        : paymentCheckoutUnavailable();
    }
    if (!snapshot) {
      throw paymentCheckoutUnavailable();
    }

    if (snapshot.status === 'approved') {
      if (!isSnapshotConsistentWithAttempt(snapshot, attempt)) {
        this.logger.error({
          event: 'rapyd_checkout_amount_mismatch',
          attemptId: attempt.id,
          expectedAmount: attempt.amount,
          expectedCurrency: attempt.currency,
          reportedAmount: snapshot.amount,
          reportedCurrency: snapshot.currency,
        });
        throw paymentCheckoutUnavailable();
      }
      await this.applyPaymentResultService.apply(attempt.id, {
        status: 'approved',
        providerPaymentId: snapshot.providerPaymentId,
      });
      throw cardPaymentAlreadyInProgress(); // it was already paid
    }

    if (snapshot.status === 'rejected') {
      // Expired / blocked: nothing can be paid in it anymore. Close it and
      // start clean.
      await this.applyPaymentResultService.apply(attempt.id, {
        status: 'rejected',
        providerPaymentId: snapshot.providerPaymentId,
        rejectionReason: snapshot.rejectionReason,
      });
      return this.startNewAttempt(engagementId, billing);
    }

    // Still unpaid and valid: the SAME checkout (idempotent restart).
    this.logger.log({
      event: 'rapyd_checkout_resumed',
      attemptId: attempt.id,
      checkoutId: attempt.providerCheckoutId,
    });
    let toolkitScriptUrl: string;
    try {
      toolkitScriptUrl = await provider.getToolkitScriptUrl(billing.country);
    } catch (error) {
      throw error instanceof PaymentProviderNotConfiguredError
        ? paymentProviderNotConfigured()
        : paymentCheckoutUnavailable();
    }
    return {
      attempt,
      checkoutId: attempt.providerCheckoutId,
      toolkitScriptUrl,
    };
  }

  private async startNewAttempt(
    engagementId: string,
    billing: BillingFacts,
  ): Promise<StartEngagementRapydCheckoutResult> {
    let attempt: PaymentAttempt;
    try {
      attempt = await this.paymentAttemptRepository.createPending({
        engagementId,
        method: PaymentMethod.RAPYD,
        amount: billing.amount,
        currency: billing.currency,
        // A checkout has no instalments concept here — always 1.
        installments: 1,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // The active slot is already taken. WHICH method holds it can only be
        // answered by reading fresh (same reasoning as the card flow).
        const active =
          await this.paymentAttemptRepository.findActiveByEngagementId(
            engagementId,
          );
        throw active?.method === PaymentMethod.CASH
          ? paymentMethodConflict()
          : cardPaymentAlreadyInProgress();
      }
      throw error;
    }
    return this.createCheckoutFor(attempt, engagementId, billing);
  }

  /**
   * Creates the checkout for a PENDING attempt and records its id. Uses the attempt's FROZEN
   * amount/currency, never a re-derived one.
   */
  private async createCheckoutFor(
    attempt: PaymentAttempt,
    engagementId: string,
    billing: BillingFacts,
  ): Promise<StartEngagementRapydCheckoutResult> {
    let result: CheckoutResult;
    try {
      result = await this.paymentProviderRegistry
        .embeddedCheckout(PaymentMethod.RAPYD)
        .createCheckout({
          amount: attempt.amount,
          currency: attempt.currency,
          country: billing.country,
          description: `GoService — Engagement ${engagementId}`,
          externalReference: engagementId,
          customerId: billing.providerCustomerId,
          idempotencyKey: attempt.id,
        });
    } catch (error) {
      if (error instanceof PaymentRequestRejectedError) {
        // Definitive: Rapyd refused and created no checkout.
        await this.applyPaymentResultService.apply(attempt.id, {
          status: 'rejected',
          providerPaymentId: null,
          rejectionReason: error.rejectionReason,
        });
        throw paymentCheckoutUnavailable();
      }
      if (error instanceof PaymentProviderNotConfiguredError) {
        // Nothing was sent, so the attempt must not linger and block a retry
        // (or another provider).
        await this.applyPaymentResultService.apply(attempt.id, {
          status: 'rejected',
          providerPaymentId: null,
          rejectionReason: 'PROVIDER_ERROR',
        });
        throw paymentProviderNotConfigured();
      }
      // `PaymentProviderUnavailableError`, or ANY unexpected failure after the
      // request may have been sent: the outcome is unknown, so the attempt is
      // deliberately left PENDING — a retry repeats the create (which may
      // orphan the first checkout; see the class comment).
      this.logger.error({
        event: 'rapyd_checkout_outcome_unknown',
        attemptId: attempt.id,
        engagementId,
        errorName: error instanceof Error ? error.name : 'unknown',
        expected: error instanceof PaymentProviderUnavailableError,
      });
      throw paymentProviderUnavailable();
    }

    await this.paymentAttemptRepository.attachProviderCheckoutIdIfPending(
      attempt.id,
      result.checkoutId,
    );
    this.logger.log({
      event: 'rapyd_checkout_started',
      attemptId: attempt.id,
      engagementId,
      checkoutId: result.checkoutId,
    });
    const current =
      (await this.paymentAttemptRepository.findById(attempt.id)) ?? attempt;
    return {
      attempt: current,
      checkoutId: result.checkoutId,
      toolkitScriptUrl: result.toolkitScriptUrl,
    };
  }
}
