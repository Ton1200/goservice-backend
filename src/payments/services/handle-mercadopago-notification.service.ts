import { Injectable, Logger } from '@nestjs/common';
import { CountryCode, PaymentAttempt, PaymentMethod } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { MercadoPagoPaymentAdapter } from '../adapters/mercadopago-payment.adapter';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { mercadoPagoSettingKeys } from '../constants/payments-setting-keys.constants';
import type { ProviderPaymentSnapshot } from '../ports/payment-provider.port';
import { isSnapshotConsistentWithAttempt } from '../utils/payment-snapshot-consistency.util';
import {
  MercadoPagoSignatureInput,
  verifyMercadoPagoSignature,
} from '../utils/mercadopago-signature.util';
import { ApplyPaymentResultService } from './apply-payment-result.service';

// `external_reference` is an `Engagement.id` (a UUID) when the order is ours.
// The Mercado Pago account may hold orders from OTHER flows with arbitrary
// references, and a non-UUID string would make Postgres throw on the `uuid`
// column — so only a well-formed UUID is ever used to look an attempt up.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Handles Mercado Pago's asynchronous notification for BOTH topics this
 * backend understands: `order` (Orders API — card flow, actions like
 * `order.processed`) and, since GOS-142, `payment` (the legacy Payments
 * API — wallet flow, the ONLY way a wallet checkout's outcome ever reaches
 * GoService, since a wallet-completed checkout does not settle against a
 * `GET /v1/orders/{id}`-reachable resource — see
 * `MercadoPagoPaymentAdapter`'s own header comment). Any other topic is
 * ignored, same as before. Its whole job is to resolve a `PaymentAttempt`
 * that the synchronous answer left PENDING (a 3DS challenge for card,
 * ALWAYS for wallet — see `StartEngagementWalletPaymentService`'s own header
 * comment) — and to do it with the SAME function the synchronous path uses
 * (`ApplyPaymentResultService`), never a second copy of the approve/reject
 * logic, and never a second copy of THIS dispatch/correlation/amount-check
 * logic either — `execute()` below is shared by both topics.
 *
 * **The notification body is never trusted.** The signature proves the request
 * came from Mercado Pago, but this service still ignores the body's claimed
 * status: it takes only the order id (`data.id`, from the signed URL) and
 * RE-READS the order from Mercado Pago (`MercadoPagoPaymentAdapter.getPayment`
 * — this handler is Mercado Pago-specific by design, so it reads through the
 * MP adapter itself rather than the multi-provider registry; GOS-146),
 * then applies that. Two consequences: a replayed or out-of-order notification
 * is harmless (it just re-reads the current truth), and a forged one cannot
 * cause a state change even if the signature check were bypassed.
 *
 * Correlation: by `providerPaymentId` (the order id, recorded when the
 * provider first answered); failing that — the create call timed out, so no id
 * was ever recorded — by `external_reference` = `Engagement.id`, adopting the
 * Engagement's still-PENDING attempt that has no provider id yet.
 *
 * Extra safety for money: an `approved` order is applied ONLY if the amount and
 * currency Mercado Pago reports equal the attempt's frozen ones; a mismatch is
 * logged as an error and NOT applied.
 *
 * Idempotent: a notification for an already-resolved attempt is a no-op — see
 * `ApplyPaymentResultService`'s CAS. Errors that are the PROVIDER's/ours
 * (provider unreachable, DB down) are deliberately NOT swallowed: they surface
 * as a 5xx so Mercado Pago retries the delivery. Only "nothing to do" outcomes
 * (unknown order, not ours, unsupported topic) return normally.
 *
 * NOT verified against a real Mercado Pago delivery — that needs a public
 * HTTPS URL, which this environment does not have (see the GOS-85 report).
 *
 * **Per-country routing (2026-09-18)**: `country` is threaded through from
 * the controller's own route segment, never derived from the notification
 * body — see `isSignatureValid`'s own comment.
 */
@Injectable()
export class HandleMercadoPagoNotificationService {
  private readonly logger = new Logger(
    HandleMercadoPagoNotificationService.name,
  );

  constructor(
    private readonly platformSettingPort: PlatformSettingPort,
    private readonly paymentProvider: MercadoPagoPaymentAdapter,
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
    private readonly applyPaymentResultService: ApplyPaymentResultService,
  ) {}

  /**
   * `false` — never throws — when the secret isn't configured, or the
   * signature is missing/malformed/wrong. A missing secret fails CLOSED (no
   * notification is accepted), never open. `country` comes from the webhook
   * ROUTE (`POST /webhooks/mercadopago/orders/:country`), never from the
   * notification body — each country's Mercado Pago application is
   * configured, in Mercado Pago's own dashboard, to call its own URL, so the
   * country (and therefore which secret to check) is known BEFORE anything
   * in the body is trusted.
   */
  async isSignatureValid(
    input: MercadoPagoSignatureInput,
    country: CountryCode,
  ): Promise<boolean> {
    const secret = await this.platformSettingPort.getValue(
      mercadoPagoSettingKeys(country).webhookSecret,
    );
    if (!secret) {
      this.logger.warn({
        event: 'mercadopago_webhook_secret_not_configured',
        country,
      });
      return false;
    }
    return verifyMercadoPagoSignature(secret, input);
  }

  async execute(params: {
    dataId: string;
    type: string | null;
    country: CountryCode;
  }): Promise<void> {
    // GOS-142 dispatch: `order` re-reads the Orders API (card flow, as
    // before); `payment` re-reads the legacy Payments API directly (wallet
    // flow — see this class's own header comment on why that's the ONLY way
    // a wallet outcome ever reaches GoService). Any other topic is ignored,
    // exactly as before GOS-142.
    let snapshot: ProviderPaymentSnapshot | null;
    if (params.type === 'order') {
      snapshot = await this.paymentProvider.getPayment(
        params.dataId,
        params.country,
      );
    } else if (params.type === 'payment') {
      snapshot = await this.paymentProvider.getPaymentByPaymentId(
        params.dataId,
        params.country,
      );
    } else {
      this.logger.log({
        event: 'mercadopago_notification_ignored',
        reason: 'unsupported_topic',
        type: params.type,
      });
      return;
    }

    if (!snapshot) {
      this.logger.log({
        event: 'mercadopago_notification_ignored',
        reason: 'payment_unknown_to_provider',
        topic: params.type,
        providerId: params.dataId,
      });
      return;
    }

    const attempt = await this.findAttempt(
      params.dataId,
      snapshot.externalReference,
    );
    if (!attempt) {
      this.logger.log({
        event: 'mercadopago_notification_ignored',
        reason: 'no_matching_attempt',
        topic: params.type,
        providerId: params.dataId,
      });
      return;
    }

    if (!isSnapshotConsistentWithAttempt(snapshot, attempt)) {
      // Never approve money we can't reconcile to what we asked for.
      this.logger.error({
        event: 'card_payment_amount_mismatch',
        attemptId: attempt.id,
        topic: params.type,
        providerId: params.dataId,
        expectedAmount: attempt.amount,
        expectedCurrency: attempt.currency,
        reportedAmount: snapshot.amount,
        reportedCurrency: snapshot.currency,
      });
      return;
    }

    await this.applyPaymentResultService.apply(attempt.id, {
      status: snapshot.status,
      providerPaymentId: params.dataId,
      rejectionReason: snapshot.rejectionReason,
    });
  }

  /** `providerId` is an order id (`order` topic) or a payment id (`payment` topic) — either shape is a valid `PaymentAttempt.providerPaymentId`. */
  private async findAttempt(
    providerId: string,
    externalReference: string | null,
  ): Promise<PaymentAttempt | null> {
    // GOS-146: scoped to Mercado Pago's own attempts — another provider's id
    // can never be adopted by a Mercado Pago notification.
    const byProviderId =
      await this.paymentAttemptRepository.findByProviderPaymentId(
        providerId,
        PaymentMethod.MERCADOPAGO,
      );
    if (byProviderId) {
      return byProviderId;
    }
    if (externalReference && UUID_PATTERN.test(externalReference)) {
      return this.paymentAttemptRepository.findPendingWithoutProviderIdByEngagementId(
        externalReference,
        PaymentMethod.MERCADOPAGO,
      );
    }
    return null;
  }
}
