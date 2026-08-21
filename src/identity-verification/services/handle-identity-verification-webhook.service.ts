import { Injectable, Logger } from '@nestjs/common';
import { IdentityVerificationStatus } from '@prisma/client';
import { UsersRepository } from '../../users/users.repository';
import { DiditIdentityVerificationAdapter } from '../adapters/didit-identity-verification.adapter';
import { IdentityVerificationRepository } from '../identity-verification.repository';

/**
 * Orchestrates the Didit webhook (`DiditWebhookController`) — the async
 * counterpart to `StartIdentityVerificationService`. Depends on the
 * CONCRETE `DiditIdentityVerificationAdapter`, not the provider-agnostic
 * `IdentityVerificationPort` — deliberate, since the webhook ROUTE itself
 * is already provider-specific (`/webhooks/didit/identity-verification`),
 * so there is no cross-provider abstraction to preserve at this layer (see
 * the implementation plan's section 8).
 *
 * Every step here is designed to be a safe no-op on anything unexpected —
 * an unresolvable/duplicate/already-decided webhook NEVER throws (this
 * service has no failure mode that should ever produce a non-200 response
 * to Didit once the controller has already verified the signature) — see
 * each early-return branch's own comment.
 */
@Injectable()
export class HandleIdentityVerificationWebhookService {
  private readonly logger = new Logger(
    HandleIdentityVerificationWebhookService.name,
  );

  constructor(
    private readonly diditAdapter: DiditIdentityVerificationAdapter,
    private readonly identityVerificationRepository: IdentityVerificationRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  async execute(rawPayload: unknown): Promise<void> {
    const result = this.diditAdapter.translateWebhookPayload(rawPayload);
    const envelope = this.asRecord(rawPayload);
    const vendorData = this.safeString(envelope.vendor_data);

    // Never logs the full payload/any extracted PII — only correlation IDs
    // and the already-computed boolean/status outcome.
    this.logger.log({
      event: 'identity_verification_webhook_received',
      eventId: this.safeString(envelope.event_id),
      sessionId: result.providerReference,
      webhookType: this.safeString(envelope.webhook_type),
      signatureValid: true, // the controller only ever calls execute() after a valid signature
    });

    if (!vendorData) {
      this.logger.warn({
        event: 'identity_verification_webhook_unresolvable',
        reason: 'missing_vendor_data',
      });
      return;
    }

    const existing =
      await this.identityVerificationRepository.findById(vendorData);
    if (!existing) {
      // A webhook for a `vendor_data` we never issued (unknown/foreign/
      // stale) — never treated as an error; nothing to update.
      this.logger.warn({
        event: 'identity_verification_webhook_unresolvable',
        reason: 'unknown_identity_verification_id',
      });
      return;
    }

    if (existing.status !== IdentityVerificationStatus.PENDING) {
      // Already decided — either a duplicate delivery of a webhook we
      // already processed, OR (structurally impossible for THIS row today,
      // since nothing else ever mutates `IdentityVerification.status`
      // except this exact code path, but defended anyway) some other
      // decision already landed. Either way: a safe no-op, not an error.
      this.logger.log({
        event: 'identity_verification_webhook_duplicate',
        identityVerificationId: existing.id,
      });
      return;
    }

    const applied =
      await this.identityVerificationRepository.updateResultIfPending(
        existing.id,
        {
          status: result.status,
          documentCheckPassed: result.documentCheckPassed,
          biometricCheckPassed: result.biometricCheckPassed,
          documentType: result.documentType,
        },
      );
    if (!applied) {
      // Raced with a concurrent, equally-valid delivery of the same
      // webhook that landed first — that call already did everything
      // below; this one is a safe no-op.
      this.logger.log({
        event: 'identity_verification_webhook_duplicate',
        identityVerificationId: existing.id,
      });
      return;
    }

    this.logger.log({
      event: 'identity_verification_completed',
      userId: existing.userId,
      providerReference: result.providerReference,
      documentCheckPassed: result.documentCheckPassed,
      biometricCheckPassed: result.biometricCheckPassed,
      status: result.status,
    });

    if (
      result.status === IdentityVerificationStatus.APPROVED ||
      result.status === IdentityVerificationStatus.REJECTED
    ) {
      const transitioned =
        await this.usersRepository.transitionFromPendingApproval(
          existing.userId,
          result.status,
        );
      this.logger.log({
        event: 'account_status_transitioned',
        userId: existing.userId,
        from: 'PENDING_APPROVAL',
        to: result.status,
        trigger: 'didit_webhook',
        // `false` here means the account was NOT in PENDING_APPROVAL
        // anymore when this ran — e.g. an admin already made a manual
        // decision first. The webhook never overwrites that decision (see
        // `UsersRepository.transitionFromPendingApproval`'s own guard).
        applied: transitioned,
      });
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  }

  private safeString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }
}
