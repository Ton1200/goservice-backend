import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentAttempt,
  EngagementStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { CURRENCY_BY_COUNTRY } from '../../ledger/constants/country-currency.constants';
import { UsersRepository } from '../../users/users.repository';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { cardPaymentAlreadyInProgress } from '../errors/card-payment-already-in-progress.error';
import { engagementNotPayableByCard } from '../errors/engagement-not-payable-by-card.error';
import { invalidCardPaymentInput } from '../errors/invalid-card-payment-input.error';
import { paymentMethodConflict } from '../errors/payment-method-conflict.error';
import { paymentProviderMisconfigured } from '../errors/payment-provider-misconfigured.error';
import { paymentProviderUnavailable } from '../errors/payment-provider-unavailable.error';
import {
  ChargeCardResult,
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
} from '../ports/payment-provider.port';
import { ApplyPaymentResultService } from './apply-payment-result.service';

export interface PayEngagementWithCardInput {
  engagementId: string;
  /** Single-use token from the client-side tokenization. NEVER logged or stored. */
  cardToken: string;
  paymentMethodId: string;
  installments: number;
}

// The card brand id the client's tokenization reports (`visa`, `master`,
// `naranja`…) is interpolated into a provider request, so only a plain
// identifier shape is accepted.
const PAYMENT_METHOD_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Orchestrates `Mutation.payEngagementWithCard` (GOS-85) — a Customer pays an
 * Engagement by card through the Mercado Pago card-token capability
 * (`PaymentProviderRegistry.cardToken`), with NO redirect (the card
 * is tokenized client-side; only the token reaches this server).
 *
 * 1. Ownership: only the Engagement's Customer
 *    (`CardPaymentAccessService`) — anyone else gets the anti-enumeration
 *    `engagementNotFound()`.
 * 2. Preconditions: status `IN_PROGRESS | PENDING_CUSTOMER_CONFIRMATION |
 *    COMPLETED` (the same window as cash — a confirmed product decision), and
 *    the payment method not already fixed to CASH.
 * 3. Amount/currency derived server-side, exactly like the rest of the ledger:
 *    `quote.negotiatedPrice ?? quote.price`, `CURRENCY_BY_COUNTRY[country]` —
 *    NEVER taken from the client.
 * 4. Insert a `PaymentAttempt(PENDING)` in its own short statement,
 *    committed BEFORE the provider is called (no DB transaction is held across
 *    an HTTP call). The partial unique index makes a second PENDING/APPROVED
 *    attempt impossible → `CARD_PAYMENT_ALREADY_IN_PROGRESS`.
 * 5. `CardTokenCapability.chargeCard`, SIMPLE charge to GoService's own
 *    account, with the attempt's id as idempotency key (a retry can't charge
 *    twice).
 * 6. Hand the outcome to `ApplyPaymentResultService` — the same function
 *    the asynchronous notification uses.
 *
 * Failure handling — what happens to the attempt row is the point:
 * - declined card → resolves as REJECTED (a normal result, returned to the
 *   caller, NOT an exception);
 * - provider says "no charge was created" (`PaymentRequestRejectedError`) →
 *   REJECTED as well;
 * - provider not configured → REJECTED (`PROVIDER_ERROR`) and
 *   `PAYMENT_PROVIDER_MISCONFIGURED` is thrown — nothing was sent, so the
 *   attempt must not linger and block a retry;
 * - outcome UNKNOWN (timeout / 5xx) → the attempt is left PENDING on purpose
 *   (a charge may exist; the notification will reconcile it) and
 *   `PAYMENT_PROVIDER_UNAVAILABLE` is thrown. **Documented gap**: a PENDING
 *   attempt that never receives a notification keeps blocking new attempts;
 *   an expiry/reconciliation job is out of scope for GOS-85.
 */
@Injectable()
export class PayEngagementWithCardService {
  private readonly logger = new Logger(PayEngagementWithCardService.name);

  constructor(
    private readonly cardPaymentAccessService: CardPaymentAccessService,
    private readonly engagementsRepository: EngagementsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
    private readonly applyPaymentResultService: ApplyPaymentResultService,
  ) {}

  async payEngagementWithCard(
    userId: string,
    input: PayEngagementWithCardInput,
  ): Promise<PaymentAttempt> {
    if (
      input.cardToken.trim() === '' ||
      !PAYMENT_METHOD_ID_PATTERN.test(input.paymentMethodId) ||
      !Number.isInteger(input.installments) ||
      input.installments < 1
    ) {
      throw invalidCardPaymentInput();
    }

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
    const amount =
      billingContext.quote.negotiatedPrice ?? billingContext.quote.price;
    const currency =
      CURRENCY_BY_COUNTRY[billingContext.customerProfile.country];

    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw engagementNotFound(); // the session's user vanished — same fold
    }

    // Resolved BEFORE the attempt is inserted: a registry wiring error must
    // never leave a PENDING attempt behind.
    const provider = this.paymentProviderRegistry.cardToken(
      PaymentMethod.MERCADOPAGO,
    );

    let attempt: PaymentAttempt;
    try {
      attempt = await this.paymentAttemptRepository.createPending({
        engagementId: engagement.id,
        // GOS-146: `payEngagementWithCard` is the Mercado Pago card-token flow
        // (its contract does not change); Rapyd has its own start mutation.
        method: PaymentMethod.MERCADOPAGO,
        amount,
        currency,
        installments: input.installments,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // The active slot is already taken. WHICH method holds it can only
        // be answered by reading fresh: `engagement` above was read BEFORE
        // this race, so a stale in-memory check would get it wrong for the
        // exact case that matters (a cash confirmation that won the race
        // after our own precondition check already passed).
        const active =
          await this.paymentAttemptRepository.findActiveByEngagementId(
            engagement.id,
          );
        throw active?.method === PaymentMethod.CASH
          ? paymentMethodConflict()
          : cardPaymentAlreadyInProgress();
      }
      throw error;
    }

    let result: ChargeCardResult;
    try {
      result = await provider.chargeCard({
        cardToken: input.cardToken,
        amount,
        currency,
        country: billingContext.customerProfile.country,
        description: `GoService — Engagement ${engagement.id}`,
        externalReference: engagement.id,
        paymentMethodId: input.paymentMethodId,
        installments: input.installments,
        payerEmail: user.email,
        idempotencyKey: attempt.id,
      });
    } catch (error) {
      if (error instanceof PaymentRequestRejectedError) {
        return this.resolveOrCurrent(
          attempt.id,
          {
            status: 'rejected',
            providerPaymentId: null,
            rejectionReason: error.rejectionReason,
          },
          attempt,
        );
      }
      if (error instanceof PaymentProviderNotConfiguredError) {
        await this.applyPaymentResultService.apply(attempt.id, {
          status: 'rejected',
          providerPaymentId: null,
          rejectionReason: 'PROVIDER_ERROR',
        });
        throw paymentProviderMisconfigured();
      }
      // `PaymentProviderUnavailableError`, or ANY unexpected failure after the
      // request may have been sent: the outcome is unknown, so the attempt is
      // deliberately left PENDING — never assumed rejected.
      this.logger.error({
        event: 'card_payment_outcome_unknown',
        attemptId: attempt.id,
        engagementId: engagement.id,
        errorName: error instanceof Error ? error.name : 'unknown',
        expected: error instanceof PaymentProviderUnavailableError,
      });
      throw paymentProviderUnavailable();
    }

    return this.resolveOrCurrent(
      attempt.id,
      {
        status: result.status,
        providerPaymentId: result.providerPaymentId,
        rejectionReason: result.rejectionReason,
      },
      attempt,
    );
  }

  private async resolveOrCurrent(
    attemptId: string,
    resolution: Parameters<ApplyPaymentResultService['apply']>[1],
    fallback: PaymentAttempt,
  ): Promise<PaymentAttempt> {
    try {
      const resolved = await this.applyPaymentResultService.apply(
        attemptId,
        resolution,
      );
      return resolved ?? fallback;
    } catch (error) {
      // The provider has ALREADY answered — for `approved` this means the
      // Customer was charged but GoService failed to record it (e.g. the
      // commission percentage is misconfigured, so the ledger write rolled the
      // whole approval back). The attempt is still PENDING, so the provider's
      // notification can still resolve it once the cause is fixed. Log the
      // provider id so an operator can reconcile by hand, then rethrow.
      this.logger.error({
        event: 'card_payment_provider_answered_but_not_recorded',
        attemptId,
        providerStatus: resolution.status,
        providerPaymentId: resolution.providerPaymentId,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
  }
}
