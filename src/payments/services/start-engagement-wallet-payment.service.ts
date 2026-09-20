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
import { engagementNotPayableByWallet } from '../errors/engagement-not-payable-by-wallet.error';
import { paymentMethodConflict } from '../errors/payment-method-conflict.error';
import { paymentProviderMisconfigured } from '../errors/payment-provider-misconfigured.error';
import { paymentProviderUnavailable } from '../errors/payment-provider-unavailable.error';
import { walletPaymentAlreadyInProgress } from '../errors/wallet-payment-already-in-progress.error';
import {
  PaymentProviderNotConfiguredError,
  PaymentProviderPort,
  PaymentProviderUnavailableError,
} from '../ports/payment-provider.port';
import { ApplyPaymentResultService } from './apply-payment-result.service';

export interface StartEngagementWalletPaymentInput {
  engagementId: string;
}

export interface StartEngagementWalletPaymentResult {
  attempt: PaymentAttempt;
  redirectUrl: string;
}

/**
 * Orchestrates `Mutation.startEngagementWalletPayment` (GOS-142) — a Customer
 * pays an Engagement by being redirected to their OWN Mercado Pago account
 * (balance or a saved card inside it), then returns to the app. Mirrors
 * `PayEngagementWithCardService`'s ownership/precondition/attempt-creation
 * shape closely (same access check, same status window, same partial-unique-
 * index race handling), but its OUTCOME shape is fundamentally different:
 *
 * **A card charge resolves synchronously; a wallet checkout never does.**
 * `chargeCard` answers "approved/rejected/pending" in the SAME request.
 * `createWalletPreference` only ever answers "here is a URL to redirect to" —
 * the actual payment decision happens later, inside Mercado Pago's own UI,
 * and reaches GoService only through the `payment` webhook (or an opportunistic
 * re-read from `myEngagementPaymentAttempt`). So THIS service never calls
 * `ApplyPaymentResultService` for approve/reject — the attempt it returns is
 * ALWAYS still PENDING (unless preference creation itself failed — see
 * below). Resolving it is `HandleMercadoPagoNotificationService`'s job.
 *
 * **Preference-creation failure is treated as DEFINITIVE, unlike a card
 * charge's ambiguous timeout.** For `chargeCard`, a timeout/5xx must leave the
 * attempt PENDING because a charge MAY have gone through. A preference is not
 * a charge — it is a request for a checkout URL — so if creating one fails
 * for ANY reason (misconfigured credentials, timeout, 5xx), NO money could
 * possibly have moved and the Customer was never even redirected: the attempt
 * is deliberately marked REJECTED (`PROVIDER_ERROR`) right here, so it never
 * lingers un-reconcilable (there is no provider id to ever correlate a
 * notification against) and the Customer can immediately retry.
 *
 * The preference id Mercado Pago returns is logged for traceability ONLY —
 * NEVER written to `PaymentAttempt.providerPaymentId` (it is a third,
 * distinct id shape, neither an order nor a payment id). The wallet attempt
 * is always later correlated to its webhook via
 * `findPendingWithoutProviderIdByEngagementId`, never by this id.
 */
@Injectable()
export class StartEngagementWalletPaymentService {
  private readonly logger = new Logger(
    StartEngagementWalletPaymentService.name,
  );

  constructor(
    private readonly cardPaymentAccessService: CardPaymentAccessService,
    private readonly engagementsRepository: EngagementsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
    private readonly paymentProvider: PaymentProviderPort,
    private readonly applyPaymentResultService: ApplyPaymentResultService,
  ) {}

  async startEngagementWalletPayment(
    userId: string,
    input: StartEngagementWalletPaymentInput,
  ): Promise<StartEngagementWalletPaymentResult> {
    // Ownership check is method-agnostic despite the class name ("only the
    // Engagement's own Customer") — reused as-is rather than duplicated; see
    // that service's own header comment.
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
      throw engagementNotPayableByWallet();
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

    let attempt: PaymentAttempt;
    try {
      attempt = await this.paymentAttemptRepository.createPending({
        engagementId: engagement.id,
        amount,
        currency,
        // A wallet payment has no instalments concept of its own here — the
        // Customer picks that (if at all) inside their own Mercado Pago
        // account, never through GoService. `1` is a neutral placeholder,
        // same column `PaymentAttempt.installments` NOT NULL requires.
        installments: 1,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Same race-resolution reasoning as `PayEngagementWithCardService`:
        // the active slot is already taken, and WHICH method holds it can
        // only be answered by reading fresh.
        const active =
          await this.paymentAttemptRepository.findActiveByEngagementId(
            engagement.id,
          );
        throw active?.method === PaymentMethod.CASH
          ? paymentMethodConflict()
          : walletPaymentAlreadyInProgress();
      }
      throw error;
    }

    try {
      const preference = await this.paymentProvider.createWalletPreference({
        amount,
        currency,
        country: billingContext.customerProfile.country,
        description: `GoService — Engagement ${engagement.id}`,
        externalReference: engagement.id,
        payerEmail: user.email,
      });
      this.logger.log({
        event: 'mercadopago_wallet_payment_started',
        attemptId: attempt.id,
        engagementId: engagement.id,
        // Traceability only — NEVER written to the attempt row (see this
        // class's own header comment).
        preferenceId: preference.preferenceId,
      });
      return { attempt, redirectUrl: preference.redirectUrl };
    } catch (error) {
      // See this class's own header comment: a preference-creation failure
      // is DEFINITIVE, never "outcome unknown" — no money could have moved.
      await this.applyPaymentResultService.apply(attempt.id, {
        status: 'rejected',
        providerPaymentId: null,
        rejectionReason: 'PROVIDER_ERROR',
      });
      if (error instanceof PaymentProviderNotConfiguredError) {
        // Own message — found via live testing (2026-09-19): the shared
        // factory's DEFAULT text says "Card payments…", which would be
        // silently wrong here (this failure can also mean the wallet-only
        // `back_urls`/`notification_url` settings are missing, not just a
        // credential).
        throw paymentProviderMisconfigured(
          'Wallet payments are not configured yet.',
        );
      }
      this.logger.error({
        event: 'mercadopago_wallet_preference_creation_failed',
        attemptId: attempt.id,
        engagementId: engagement.id,
        errorName: error instanceof Error ? error.name : 'unknown',
        expected: error instanceof PaymentProviderUnavailableError,
      });
      throw paymentProviderUnavailable();
    }
  }
}
