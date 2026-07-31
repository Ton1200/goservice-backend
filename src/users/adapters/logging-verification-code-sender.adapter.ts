import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { VerificationCodeSenderPort } from '../ports/verification-code-sender.port';

/**
 * Stub/logging-only adapter — real email delivery is explicitly out of
 * scope for GOS-22. Logs only an event name and outcome, plus a short,
 * non-reversible correlation hash of the email (for matching log lines
 * across a request), and NEVER the plaintext verification code or the raw
 * email address.
 */
@Injectable()
export class LoggingVerificationCodeSenderAdapter implements VerificationCodeSenderPort {
  private readonly logger = new Logger(
    LoggingVerificationCodeSenderAdapter.name,
  );

  // `code` is intentionally not a parameter here even though the port
  // declares it (implementations may narrow their signature) — this stub
  // must never receive, hold, or log the plaintext code.
  async sendVerificationCode(email: string): Promise<void> {
    this.logger.log({
      event: 'email_verification_code_send_stub',
      outcome: 'stub_logged_no_real_email_sent',
      correlationId: this.correlationHash(email),
    });
    await Promise.resolve();
  }

  /**
   * Short, one-way correlation id derived from the email — lets log lines
   * for the same address be matched across a request without ever storing
   * or emitting the raw address.
   */
  private correlationHash(email: string): string {
    return createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex')
      .slice(0, 12);
  }
}
