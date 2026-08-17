import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { DiditIdentityVerificationAdapter } from '../adapters/didit-identity-verification.adapter';
import { HandleIdentityVerificationWebhookService } from '../services/handle-identity-verification-webhook.service';

/**
 * The first REST (non-GraphQL) endpoint in this backend — Didit calls this
 * directly over plain HTTP, never through `/graphql`. Deliberately public
 * internet-facing: no `SessionGuard` (this is not a user's own request,
 * it's the PROVIDER calling us) — its only protection is the HMAC signature
 * + timestamp-window check in `DiditIdentityVerificationAdapter.
 * verifyWebhookSignature`.
 *
 * Reads `req.rawBody` (NOT `req.body`) to get the exact, unmodified bytes
 * Didit sent, before Nest's/Express's own JSON body-parser could have
 * re-parsed/re-serialized them — required so
 * `verifyWebhookSignature(rawBody, ...)` verifies against the literal bytes
 * the signature was computed over. This is why `main.ts`/`test-app.ts` now
 * pass `rawBody: true` to `NestFactory.create()` — see those files' own
 * comments.
 *
 * Returns a plain `{ received: true }` / throws a plain
 * `UnauthorizedException` (a REST 401), never a `DomainException` — this
 * route is NOT behind `DomainExceptionFilter` (that filter is
 * GraphQL-specific, see its own header comment) and every failure mode
 * `HandleIdentityVerificationWebhookService.execute()` can hit is already a
 * safe, logged no-op rather than a thrown error — see that service's own
 * header comment.
 *
 * Throttling: `@UseGuards(ThrottlerGuard)` here is the BASE `@nestjs/throttler`
 * guard (not `GqlThrottlerGuard`, the app-wide `APP_GUARD` — see that
 * class's own updated header comment on why it now no-ops for any
 * non-GraphQL context, deferring to this controller's own guard instead).
 * `ThrottlerGuard`'s default `getRequestResponse` (`context.switchToHttp()`)
 * is exactly correct here, since this IS a plain REST context — no override
 * needed, unlike the GraphQL case. `@Throttle` sets a volume limit
 * independent of, and separate from, the `default` GraphQL-facing 20/60s
 * limit — deliberately generous (Didit may legitimately retry a delivery),
 * but still a real ceiling against abuse of this public endpoint, per the
 * implementation plan's own explicit requirement (section 8: "Debe
 * excluirse explícitamente de cualquier rate-limit pensado para usuarios
 * autenticados y en cambio tener el suyo propio").
 */
@Controller('webhooks/didit')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class DiditWebhookController {
  private readonly logger = new Logger(DiditWebhookController.name);

  constructor(
    private readonly diditAdapter: DiditIdentityVerificationAdapter,
    private readonly handleIdentityVerificationWebhookService: HandleIdentityVerificationWebhookService,
  ) {}

  @Post('identity-verification')
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string>,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody?.toString('utf8') ?? '';

    const signatureValid = await this.diditAdapter.verifyWebhookSignature(
      rawBody,
      headers,
    );
    if (!signatureValid) {
      // A generic 401 — never discloses WHY the signature failed (missing
      // header, bad HMAC, stale timestamp, no secret configured are all
      // indistinguishable from the outside), same anti-enumeration
      // discipline `authenticateRequest()` already applies to
      // `UNAUTHENTICATED`.
      this.logger.warn({
        event: 'identity_verification_webhook_received',
        signatureValid: false,
      });
      throw new UnauthorizedException();
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // Malformed JSON despite a VALID signature (should not happen for a
      // legitimate Didit call) — never a 500; log and acknowledge so Didit
      // does not endlessly retry an unprocessable payload.
      this.logger.warn({
        event: 'identity_verification_webhook_malformed_body',
      });
      return { received: true };
    }

    await this.handleIdentityVerificationWebhookService.execute(payload);
    return { received: true };
  }
}
