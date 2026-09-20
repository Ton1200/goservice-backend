import { Injectable, Logger } from '@nestjs/common';
import {
  CountryCode,
  PaymentAttempt,
  PaymentAttemptStatus,
  PaymentMethod,
} from '@prisma/client';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { RecordDigitalPaymentService } from '../../ledger/services/record-digital-payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import {
  PaymentProviderPort,
  type CardRejectionReason,
  type ProviderTransactionDetails,
} from '../ports/payment-provider.port';

/** What the provider (synchronously, or via its notification) says happened. */
export interface PaymentResolution {
  status: 'approved' | 'rejected' | 'pending';
  /** The provider's id for the charge; null when the provider never answered with one. */
  providerPaymentId: string | null;
  rejectionReason?: CardRejectionReason;
}

/**
 * THE one function that turns a provider outcome into GoService state — called
 * by BOTH the synchronous path (`PayEngagementWithCardService`, right after
 * `PaymentProviderPort.chargeCard`) and the asynchronous one
 * (`HandleMercadoPagoNotificationService`). One implementation, never two
 * copies that could drift: "a notification approves a payment exactly like the
 * synchronous answer would" is true by construction.
 *
 * - `approved`: in ONE transaction — flip the attempt `PENDING -> APPROVED`
 *   (guarded CAS), write the 3-row digital-payment ledger event
 *   (`RecordDigitalPaymentService`) and set
 *   `Engagement.paymentMethod = MERCADOPAGO` if unset. A failure anywhere (e.g. the
 *   commission percentage is misconfigured) rolls ALL of it back, leaving the
 *   attempt PENDING — never an APPROVED attempt with no ledger event.
 *   The non-sensitive facts of how it was paid (brand, last four, the
 *   provider's fee/net…) are read from the provider BEFORE the transaction
 *   opens (never an HTTP call inside it) and written in the same statement as
 *   the status flip. That read is BEST-EFFORT: if it fails or finds nothing the
 *   fields stay null — the payment is still approved and recorded, never failed
 *   or held up for it.
 * - `rejected`: flip `PENDING -> REJECTED` with the domain reason. No ledger, no
 *   charge.
 * - `pending`: no state change beyond recording the provider's id on the
 *   still-open attempt, so a later notification can find it.
 *
 * **Idempotent by the CAS, not by luck**: `resolveIfPending` only succeeds
 * while the attempt is still PENDING. A repeated or concurrent notification for
 * an already-resolved attempt gets `count === 0` and returns having written
 * nothing — the ledger can never be duplicated.
 *
 * Returns the attempt's CURRENT persisted state (or `null` if it no longer
 * exists, e.g. its Engagement was hard-deleted).
 */
@Injectable()
export class ApplyPaymentResultService {
  private readonly logger = new Logger(ApplyPaymentResultService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
    private readonly engagementsRepository: EngagementsRepository,
    private readonly recordDigitalPaymentService: RecordDigitalPaymentService,
    private readonly paymentProvider: PaymentProviderPort,
  ) {}

  async apply(
    attemptId: string,
    resolution: PaymentResolution,
  ): Promise<PaymentAttempt | null> {
    const attempt = await this.paymentAttemptRepository.findById(attemptId);
    if (!attempt) {
      return null;
    }

    if (resolution.status === 'pending') {
      if (resolution.providerPaymentId) {
        await this.paymentAttemptRepository.attachProviderPaymentIdIfPending(
          attemptId,
          resolution.providerPaymentId,
        );
      }
      return this.paymentAttemptRepository.findById(attemptId);
    }

    if (attempt.status !== PaymentAttemptStatus.PENDING) {
      // Fast path — already resolved. The CAS below would also no-op; this
      // just skips the billing read.
      this.logger.log({
        event: 'card_payment_resolution_ignored',
        reason: 'already_resolved',
        attemptId,
        currentStatus: attempt.status,
      });
      return attempt;
    }

    const approved = resolution.status === 'approved';

    // Billing context read BEFORE the transaction opens (same idiom as
    // `ConfirmCashPaymentService`). Needed only for the ledger event; the
    // profile ids never change once an Engagement exists.
    const engagement = approved
      ? await this.engagementsRepository.findByIdWithBillingContext(
          attempt.engagementId,
        )
      : null;
    if (approved && !engagement) {
      return null;
    }

    // Only an APPROVED payment has details to read; for the others the field
    // is not passed at all.
    const details =
      approved && engagement
        ? await this.readTransactionDetails(
            attempt,
            resolution.providerPaymentId,
            engagement.customerProfile.country,
          )
        : undefined;

    const applied = await this.prisma.$transaction(async (tx) => {
      const cas = await this.paymentAttemptRepository.resolveIfPending(
        tx,
        attemptId,
        {
          status: approved ? 'APPROVED' : 'REJECTED',
          providerPaymentId: resolution.providerPaymentId,
          rejectionReason: approved
            ? null
            : (resolution.rejectionReason ?? 'OTHER'),
          details,
        },
      );
      if (cas.count !== 1) {
        return false; // lost the race — someone already resolved it
      }

      if (approved && engagement) {
        await this.recordDigitalPaymentService.recordDigitalPayment(tx, {
          engagementId: attempt.engagementId,
          // The FROZEN amount actually charged — never re-derived from the
          // Quote, which could have changed since.
          quotedPrice: attempt.amount,
          currency: attempt.currency,
          customerProfileId: engagement.customerProfileId,
          professionalProfileId: engagement.professionalProfileId,
        });
        const method = await this.engagementsRepository.setPaymentMethodIfUnset(
          tx,
          attempt.engagementId,
          PaymentMethod.MERCADOPAGO,
        );
        if (method.count !== 1) {
          // Not an error path we can fix here: the Engagement's method was
          // already fixed (to CASH, by a race with confirmCashPayment) after
          // our precheck. The money WAS charged and the ledger event is
          // correct; surface it loudly for a human instead of failing.
          this.logger.warn({
            event: 'card_payment_method_already_set',
            attemptId,
            engagementId: attempt.engagementId,
          });
        }
      }
      return true;
    });

    this.logger.log({
      event: 'card_payment_resolved',
      attemptId,
      engagementId: attempt.engagementId,
      status: approved ? 'APPROVED' : 'REJECTED',
      outcome: applied ? 'applied' : 'already_resolved',
    });

    return this.paymentAttemptRepository.findById(attemptId);
  }

  /**
   * BEST-EFFORT — see the class comment. ANY failure (provider unreachable,
   * credentials, a malformed body, the record not being there yet) becomes
   * `null`; it is logged by error NAME only (never a message, which could echo
   * request details) and never propagates.
   */
  private async readTransactionDetails(
    attempt: PaymentAttempt,
    providerPaymentId: string | null,
    country: CountryCode,
  ): Promise<ProviderTransactionDetails | null> {
    if (!providerPaymentId) {
      return null;
    }
    try {
      const details = await this.paymentProvider.getTransactionDetails(
        providerPaymentId,
        // The reference sent to the provider at creation is the Engagement id.
        attempt.engagementId,
        country,
      );
      if (!details) {
        this.logger.warn({
          event: 'payment_details_not_available_yet',
          attemptId: attempt.id,
        });
      }
      return details;
    } catch (error) {
      this.logger.warn({
        event: 'payment_details_unavailable',
        attemptId: attempt.id,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return null;
    }
  }
}
