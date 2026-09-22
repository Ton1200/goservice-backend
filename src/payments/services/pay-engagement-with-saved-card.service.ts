import { Injectable, Logger } from '@nestjs/common';
import {
  EngagementStatus,
  PaymentAttempt,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { CURRENCY_BY_COUNTRY } from '../../ledger/constants/country-currency.constants';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { UsersRepository } from '../../users/users.repository';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { PAYMENT_METHOD_SETTING_KEYS } from '../constants/payments-setting-keys.constants';
import { cardPaymentAlreadyInProgress } from '../errors/card-payment-already-in-progress.error';
import { cardPaymentModuleDisabled } from '../errors/card-payment-module-disabled.error';
import { engagementNotPayableByCard } from '../errors/engagement-not-payable-by-card.error';
import { mercadoPagoSavedCardsDisabled } from '../errors/mercadopago-saved-cards-disabled.error';
import { paymentMethodConflict } from '../errors/payment-method-conflict.error';
import { paymentProviderNotConfigured } from '../errors/payment-provider-not-configured.error';
import { paymentProviderUnavailable } from '../errors/payment-provider-unavailable.error';
import { rapydModuleDisabled } from '../errors/rapyd-module-disabled.error';
import { rapydSavedCardsDisabled } from '../errors/rapyd-saved-cards-disabled.error';
import { savedCardNotFound } from '../errors/saved-card-not-found.error';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import {
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
  type ProviderPaymentSnapshot,
} from '../ports/payment-provider.port';
import { SavedCardRepository } from '../saved-card.repository';
import { isSnapshotConsistentWithAttempt } from '../utils/payment-snapshot-consistency.util';
import { ApplyPaymentResultService } from './apply-payment-result.service';
import { MercadoPagoSavedCardsCustomerService } from './mercadopago-saved-cards-customer.service';
import { RapydSavedCardsCustomerService } from './rapyd-saved-cards-customer.service';

export interface PayEngagementWithSavedCardInput {
  engagementId: string;
  savedCardId: string;
  /**
   * GOS-149 — MERCADO PAGO ONLY. See
   * `ChargeSavedCardCommand.providerToken`'s own comment. Ignored for a
   * Rapyd card.
   */
  providerToken?: string;
}

/**
 * Orchestrates `Mutation.payEngagementWithSavedCard` — pays an Engagement
 * with a card the Customer already saved, of WHATEVER provider it belongs to
 * (GOS-146: Rapyd, a true one-tap charge; GOS-149: Mercado Pago, which still
 * needs a client-re-tokenized CVV — see `PayEngagementWithSavedCardInput.providerToken`'s
 * own comment). Same shape as `PayEngagementWithCardService` (a charge that
 * usually RESOLVES in the same request), and it resolves the attempt with
 * the same `ApplyPaymentResultService`.
 *
 * 1. Ownership: only the Engagement's Customer, and only a card that is
 *    THEIRS (`SAVED_CARD_NOT_FOUND` otherwise — also for a card saved in
 *    another environment of its own provider, which does not exist for
 *    today's credentials). The card's OWN `method` decides which provider
 *    this call uses — never a hardcoded one.
 * 2. Preconditions: status `IN_PROGRESS | PENDING_CUSTOMER_CONFIRMATION |
 *    COMPLETED`, payment method not fixed to CASH — same as every card flow.
 *    Also: the target card's OWN provider must have its saved-cards feature
 *    ON (checked here, precisely, now that this mutation serves more than
 *    one provider — see `assertSavedCardsEnabledFor`).
 * 3. Amount/currency derived server-side from the accepted Quote — never sent
 *    by the client.
 * 4. The `PaymentAttempt(method: <card's own method>, savedCardId: card.id,
 *    PENDING)` is inserted first (the partial unique index makes a second
 *    active attempt impossible, across providers); an open Rapyd checkout of
 *    the same Engagement therefore answers `CARD_PAYMENT_ALREADY_IN_PROGRESS`
 *    — the client abandons it first. `savedCardId` — see
 *    `PaymentAttempt.savedCardId`'s own schema comment.
 * 5. `chargeSavedCard`, then the result is applied:
 *    - `approved` → the ledger trio is written (same code path as a card);
 *    - `rejected` → the attempt is REJECTED with the domain reason. If the
 *      issuer demands 3D Secure (`AUTHENTICATION_REQUIRED`) nothing was
 *      charged (the adapter cancelled the payment, Rapyd only): the client
 *      falls back to the normal embedded checkout, where the challenge can
 *      be shown;
 *    - `pending` → the attempt stays PENDING with the provider payment id
 *      recorded; a notification or a later re-read resolves it.
 *
 * Failure handling mirrors the card flow: provider not configured → REJECTED
 * + `PAYMENT_PROVIDER_NOT_CONFIGURED`; refused → REJECTED; outcome UNKNOWN
 * (timeout/5xx) → left PENDING (a charge may exist) + `PAYMENT_PROVIDER_UNAVAILABLE`.
 * Amount/currency of an APPROVED answer must equal the attempt's frozen ones,
 * else nothing is approved (logged).
 */
@Injectable()
export class PayEngagementWithSavedCardService {
  private readonly logger = new Logger(PayEngagementWithSavedCardService.name);

  constructor(
    private readonly cardPaymentAccessService: CardPaymentAccessService,
    private readonly engagementsRepository: EngagementsRepository,
    private readonly profilesRepository: ProfilesRepository,
    private readonly usersRepository: UsersRepository,
    private readonly platformSettingPort: PlatformSettingPort,
    private readonly savedCardRepository: SavedCardRepository,
    private readonly rapydCustomerService: RapydSavedCardsCustomerService,
    private readonly mercadoPagoCustomerService: MercadoPagoSavedCardsCustomerService,
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
    private readonly applyPaymentResultService: ApplyPaymentResultService,
  ) {}

  async payEngagementWithSavedCard(
    userId: string,
    input: PayEngagementWithSavedCardInput,
  ): Promise<PaymentAttempt> {
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
      throw engagementNotFound(); // a hard delete raced this call
    }
    const amount =
      billingContext.quote.negotiatedPrice ?? billingContext.quote.price;
    const currency =
      CURRENCY_BY_COUNTRY[billingContext.customerProfile.country];

    // GOS-149 — profile/card loaded FIRST: which provider this call uses
    // depends on the CARD's own method, so it can no longer be resolved
    // before we know which card was requested.
    const profile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    const card = profile
      ? await this.savedCardRepository.findCardOfCustomer(
          input.savedCardId,
          profile.id,
        )
      : null;
    if (!profile || !card) {
      throw savedCardNotFound();
    }
    // Precise, per-card check — a resolver-level guard can no longer apply
    // here (this mutation now serves more than one provider).
    await this.assertSavedCardsEnabledFor(card.method);

    const provider = this.paymentProviderRegistry.savedCards(card.method);
    const country =
      card.method === PaymentMethod.MERCADOPAGO
        ? billingContext.customerProfile.country
        : undefined;
    let providerCustomerId: string;
    try {
      const link =
        card.method === PaymentMethod.MERCADOPAGO
          ? await this.mercadoPagoCustomerService.find(
              profile.id,
              billingContext.customerProfile.country,
            )
          : await this.rapydCustomerService.find(profile.id);
      if (!link || link.environment !== card.environment) {
        throw savedCardNotFound();
      }
      providerCustomerId = link.providerCustomerId;
    } catch (error) {
      if (error instanceof PaymentProviderNotConfiguredError) {
        throw paymentProviderNotConfigured();
      }
      throw error;
    }

    let attempt: PaymentAttempt;
    try {
      attempt = await this.paymentAttemptRepository.createPending({
        engagementId: engagement.id,
        method: card.method,
        amount,
        currency,
        // GoService only sells single-payment charges.
        installments: 1,
        savedCardId: card.id,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // The active slot is already taken; which method holds it can only be
        // answered by reading fresh (same reasoning as the card flow).
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

    let result: ProviderPaymentSnapshot;
    try {
      result = await provider.chargeSavedCard({
        customerId: providerCustomerId,
        providerCardId: card.providerCardId,
        amount,
        currency,
        description: `GoService — Engagement ${engagement.id}`,
        externalReference: engagement.id,
        idempotencyKey: attempt.id,
        country,
        providerToken: input.providerToken,
        paymentMethodId: card.brand ?? undefined,
        payerEmail:
          card.method === PaymentMethod.MERCADOPAGO
            ? await this.payerEmail(userId)
            : undefined,
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
        throw paymentProviderNotConfigured();
      }
      // `PaymentProviderUnavailableError`, or ANY unexpected failure after the
      // request may have been sent: the outcome is unknown, so the attempt is
      // deliberately left PENDING — never assumed rejected.
      this.logger.error({
        event: 'saved_card_payment_outcome_unknown',
        attemptId: attempt.id,
        engagementId: engagement.id,
        errorName: error instanceof Error ? error.name : 'unknown',
        expected: error instanceof PaymentProviderUnavailableError,
      });
      throw paymentProviderUnavailable();
    }

    if (
      result.status === 'approved' &&
      !isSnapshotConsistentWithAttempt(result, attempt)
    ) {
      // Never approve money that does not reconcile to what was asked for.
      this.logger.error({
        event: 'saved_card_payment_amount_mismatch',
        attemptId: attempt.id,
        expectedAmount: attempt.amount,
        expectedCurrency: attempt.currency,
        reportedAmount: result.amount,
        reportedCurrency: result.currency,
      });
      throw paymentProviderUnavailable();
    }

    if (result.status === 'pending') {
      // Not decided yet: keep the attempt open, but remember the provider's
      // id so a notification (or a re-read) can find and resolve it.
      await this.paymentAttemptRepository.attachProviderPaymentIdIfPending(
        attempt.id,
        result.providerPaymentId,
      );
      return (
        (await this.paymentAttemptRepository.findById(attempt.id)) ?? attempt
      );
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
      // The provider has ALREADY answered — for `approved` the Customer was
      // charged but GoService failed to record it. The attempt is still
      // PENDING so Rapyd's notification can still resolve it once the cause is
      // fixed; log the provider id for a manual reconciliation, then rethrow.
      this.logger.error({
        event: 'saved_card_payment_provider_answered_but_not_recorded',
        attemptId,
        providerStatus: resolution.status,
        providerPaymentId: resolution.providerPaymentId,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
  }

  /**
   * GOS-149 — the precise, per-card replacement for the blanket
   * `RapydSavedCardsEnabledGuard` this mutation used to sit behind: it can no
   * longer apply now that this one mutation serves more than one provider.
   * Throws the SAME codes each provider's own guard already throws.
   */
  private async assertSavedCardsEnabledFor(
    method: PaymentMethod,
  ): Promise<void> {
    if (method === PaymentMethod.MERCADOPAGO) {
      if (
        !(await this.platformSettingPort.isEnabled(
          PAYMENT_METHOD_SETTING_KEYS.mercadoPagoCard.enabled,
        ))
      ) {
        throw cardPaymentModuleDisabled();
      }
      if (
        !(await this.platformSettingPort.isEnabled(
          PAYMENT_METHOD_SETTING_KEYS.mercadoPagoCard.savedCardsEnabled,
        ))
      ) {
        throw mercadoPagoSavedCardsDisabled();
      }
      return;
    }
    if (
      !(await this.platformSettingPort.isEnabled(
        PAYMENT_METHOD_SETTING_KEYS.rapyd.enabled,
      ))
    ) {
      throw rapydModuleDisabled();
    }
    if (
      !(await this.platformSettingPort.isEnabled(
        PAYMENT_METHOD_SETTING_KEYS.rapyd.savedCardsEnabled,
      ))
    ) {
      throw rapydSavedCardsDisabled();
    }
  }

  /** GOS-149 — MERCADO PAGO ONLY: the Orders API requires `payer.email` on every order. */
  private async payerEmail(userId: string): Promise<string | undefined> {
    const user = await this.usersRepository.findById(userId);
    return user?.email;
  }
}
