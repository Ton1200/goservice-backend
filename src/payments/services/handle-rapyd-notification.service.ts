import { Injectable, Logger } from '@nestjs/common';
import { PaymentAttempt, PaymentMethod } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { RapydPaymentAdapter } from '../adapters/rapyd-payment.adapter';
import {
  mercadoPagoWalletCheckoutSettingKeys,
  rapydSettingKeys,
} from '../constants/payments-setting-keys.constants';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import {
  isRapydCheckoutId,
  isRapydPaymentId,
} from '../utils/rapyd-checkout.mapper';
import { isSnapshotConsistentWithAttempt } from '../utils/payment-snapshot-consistency.util';
import {
  RapydWebhookSignatureInput,
  verifyRapydWebhookSignature,
} from '../utils/rapyd-signature.util';
import { ApplyPaymentResultService } from './apply-payment-result.service';
import {
  AttemptProviderState,
  checkoutSnapshotToState,
  paymentSnapshotToState,
} from './read-attempt-provider-state.service';

// The merchant reference of a checkout is an `Engagement.id` (a UUID) when the
// checkout is ours. The Rapyd account may hold payments from OTHER flows with
// arbitrary references, and a non-UUID string would make Postgres throw on the
// `uuid` column — so only a well-formed UUID is ever used to look an attempt up.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rapyd does not document a replay window, so a stale timestamp is NOT a
// reason to reject (the body is never trusted anyway — the state is re-read).
// It is only noteworthy enough to log.
const STALE_TIMESTAMP_SECONDS = 10 * 60;

export interface RapydWebhookHeaders {
  signature: string | undefined;
  salt: string | undefined;
  timestamp: string | undefined;
}

/**
 * Handles Rapyd's asynchronous notification (GOS-146) — the way the outcome of
 * a payment made inside the embedded widget reaches GoService (the widget's
 * own client-side events are NOT a source of truth). Same shape as
 * `HandleMercadoPagoNotificationService`, and it resolves the attempt with the
 * SAME `ApplyPaymentResultService` — never a second copy of the approve/reject
 * logic. Like the Mercado Pago handler it is provider-specific by design, so it
 * reads through `RapydPaymentAdapter` itself rather than the multi-provider
 * registry.
 *
 * **One Rapyd account, one webhook URL, one key pair** (verified live
 * 2026-09-21: the same credentials serve Colombia and Argentina): there is no
 * per-country route or secret here.
 *
 * **The notification body is never trusted.** The signature proves the request
 * came from Rapyd, but this service ignores every status the body claims: it
 * takes only the resource id (`data.id`, a `payment_…` or `checkout_…` id) to
 * find the attempt, RE-READS the real state from Rapyd's API and applies THAT.
 * A replayed, duplicated or out-of-order notification is therefore harmless
 * (it re-reads the current truth; the CAS in `ApplyPaymentResultService` makes
 * a repeat a no-op), and a forged one cannot cause a state change even if the
 * signature check were bypassed. The event `type` is not consulted at all.
 *
 * Correlation, in order: the attempt's own `providerCheckoutId` /
 * `providerPaymentId`; failing that (the payment is new, or the create call
 * timed out and no id was recorded) the payment's merchant reference —
 * `Engagement.id`, validated as a UUID BEFORE it touches Postgres — adopting
 * the Engagement's PENDING Rapyd attempt.
 *
 * What is re-read is the attempt's CHECKOUT whenever it has one (the checkout
 * decides — see `ProviderCheckoutSnapshot`: a failed payment inside a still-open
 * checkout is NOT a rejection, because the widget lets the Customer retry). Only
 * an attempt that never learned its checkout id (the lost-response window) is
 * approved directly from the payment, and only when the payment is paid.
 * An `approved` result is applied ONLY if amount and currency equal the
 * attempt's frozen ones (`isSnapshotConsistentWithAttempt`).
 *
 * Errors that are Rapyd's/ours (Rapyd unreachable, DB down) are deliberately
 * NOT swallowed: they surface as a 5xx so Rapyd retries. Only "nothing to do"
 * outcomes (unknown id, not ours, unsupported resource) return normally.
 *
 * Verified with a SYNTHETIC delivery (signed per Rapyd's docs, with the real
 * keys) — NOT against a real Rapyd delivery, which needs a public HTTPS URL
 * registered in Rapyd's Client Portal. See `verifyRapydWebhookSignature` for
 * what Rapyd's docs leave open.
 */
@Injectable()
export class HandleRapydNotificationService {
  private readonly logger = new Logger(HandleRapydNotificationService.name);

  constructor(
    private readonly platformSettingPort: PlatformSettingPort,
    private readonly rapydAdapter: RapydPaymentAdapter,
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
    private readonly applyPaymentResultService: ApplyPaymentResultService,
  ) {}

  /**
   * `false` — never throws — when the keys or the public base URL are not
   * configured, or the signature is missing/malformed/wrong: fails CLOSED.
   *
   * The signed `url_path` is Rapyd's "entire URL configured for your company to
   * receive webhooks": rebuilt here as `<publicBaseUrl>/webhooks/rapyd` from
   * the SAME global public base URL Mercado Pago's wallet uses — never from
   * `req.originalUrl`, because behind a proxy/tunnel the path Nest sees can
   * differ from what Rapyd signed. The URL an admin enters in Rapyd's Client
   * Portal must therefore equal that value exactly.
   */
  async isSignatureValid(
    input: RapydWebhookHeaders & { rawBody: string },
  ): Promise<boolean> {
    const keys = rapydSettingKeys();
    const [accessKey, secretKey, publicBaseUrl] = await Promise.all([
      this.platformSettingPort.getValue(keys.accessKey),
      this.platformSettingPort.getValue(keys.secretKey),
      this.platformSettingPort.getValue(
        mercadoPagoWalletCheckoutSettingKeys().publicBaseUrl,
      ),
    ]);
    if (
      !accessKey ||
      accessKey.trim() === '' ||
      !secretKey ||
      secretKey.trim() === '' ||
      !publicBaseUrl ||
      publicBaseUrl.trim() === ''
    ) {
      this.logger.warn({ event: 'rapyd_webhook_not_configured' });
      return false;
    }

    const signatureInput: RapydWebhookSignatureInput = {
      signature: input.signature,
      salt: input.salt,
      timestamp: input.timestamp,
      webhookUrl: `${publicBaseUrl.trim().replace(/\/+$/, '')}/webhooks/rapyd`,
      rawBody: input.rawBody,
      accessKey: accessKey.trim(),
      secretKey: secretKey.trim(),
    };
    const valid = verifyRapydWebhookSignature(signatureInput);

    if (valid && input.timestamp) {
      const ageSeconds = Math.abs(Date.now() / 1000 - Number(input.timestamp));
      if (ageSeconds > STALE_TIMESTAMP_SECONDS) {
        this.logger.warn({
          event: 'rapyd_webhook_stale_timestamp',
          ageSeconds: Math.round(ageSeconds),
        });
      }
    }
    return valid;
  }

  async execute(params: { payload: unknown }): Promise<void> {
    const resourceId = this.extractResourceId(params.payload);
    if (!resourceId) {
      this.logger.log({
        event: 'rapyd_notification_ignored',
        reason: 'unsupported_resource',
      });
      return;
    }

    const attempt = await this.findAttempt(resourceId);
    if (!attempt) {
      this.logger.log({
        event: 'rapyd_notification_ignored',
        reason: 'no_matching_attempt',
        resourceId,
      });
      return;
    }

    const state = await this.readState(attempt, resourceId);
    if (!state) {
      this.logger.log({
        event: 'rapyd_notification_ignored',
        reason: 'unknown_to_provider',
        resourceId,
      });
      return;
    }

    if (!isSnapshotConsistentWithAttempt(state, attempt)) {
      // Never approve money we can't reconcile to what we asked for.
      this.logger.error({
        event: 'rapyd_payment_amount_mismatch',
        attemptId: attempt.id,
        resourceId,
        expectedAmount: attempt.amount,
        expectedCurrency: attempt.currency,
        reportedAmount: state.amount,
        reportedCurrency: state.currency,
      });
      return;
    }

    await this.applyPaymentResultService.apply(attempt.id, {
      status: state.status,
      providerPaymentId: state.providerPaymentId ?? attempt.providerPaymentId,
      rejectionReason: state.rejectionReason,
    });
  }

  /** `data.id` when it is a Rapyd payment or checkout id — anything else is ignored. */
  private extractResourceId(payload: unknown): string | null {
    const id = (payload as { data?: { id?: unknown } } | null)?.data?.id;
    return typeof id === 'string' &&
      (isRapydPaymentId(id) || isRapydCheckoutId(id))
      ? id
      : null;
  }

  private async findAttempt(
    resourceId: string,
  ): Promise<PaymentAttempt | null> {
    if (isRapydCheckoutId(resourceId)) {
      return this.paymentAttemptRepository.findByProviderCheckoutId(
        resourceId,
        PaymentMethod.RAPYD,
      );
    }

    const byPaymentId =
      await this.paymentAttemptRepository.findByProviderPaymentId(
        resourceId,
        PaymentMethod.RAPYD,
      );
    if (byPaymentId) {
      return byPaymentId;
    }

    // A payment GoService has not linked yet: ask Rapyd whose it is, by the
    // merchant reference it echoes (= Engagement.id).
    const payment = await this.rapydAdapter.readPayment(resourceId);
    if (
      !payment?.externalReference ||
      !UUID_PATTERN.test(payment.externalReference)
    ) {
      return null;
    }
    return this.paymentAttemptRepository.findPendingByEngagementIdAndMethod(
      payment.externalReference,
      PaymentMethod.RAPYD,
    );
  }

  /**
   * The attempt's current state from Rapyd — through the CHECKOUT when the
   * attempt has one. When the notification is about a payment that ended up
   * matched to an attempt by merchant reference and the checkout's own payment
   * is a DIFFERENT one, the notification's payment belongs to another
   * (older/abandoned) checkout: nothing is applied from it, but if it is paid
   * that is money GoService will not record — logged loudly for an operator.
   */
  private async readState(
    attempt: PaymentAttempt,
    resourceId: string,
  ): Promise<AttemptProviderState | null> {
    if (attempt.providerCheckoutId) {
      const checkout = await this.rapydAdapter.getCheckoutSnapshot(
        attempt.providerCheckoutId,
      );
      const state = checkout ? checkoutSnapshotToState(checkout) : null;
      if (
        isRapydPaymentId(resourceId) &&
        state?.providerPaymentId &&
        state.providerPaymentId !== resourceId
      ) {
        const other = await this.rapydAdapter.readPayment(resourceId);
        if (other?.status === 'approved') {
          this.logger.error({
            event: 'rapyd_payment_for_other_checkout',
            attemptId: attempt.id,
            paymentId: resourceId,
          });
        }
      }
      return state;
    }

    // A payment id but no checkout: a SERVER-SIDE saved-card charge (a checkout
    // attempt learns its payment id only when it is resolved). Nobody can retry
    // it, so a failed one is terminal — see `readSavedCardCharge`.
    if (attempt.providerPaymentId && isRapydPaymentId(resourceId)) {
      const charge = await this.rapydAdapter.readSavedCardCharge(
        attempt.providerPaymentId,
      );
      return charge ? paymentSnapshotToState(charge) : null;
    }

    // No checkout id recorded (the create call timed out): all that can be
    // done is to approve from the payment itself, and only when it is paid.
    if (!isRapydPaymentId(resourceId)) {
      return null;
    }
    const payment = await this.rapydAdapter.readPayment(resourceId);
    return payment ? paymentSnapshotToState(payment) : null;
  }
}
