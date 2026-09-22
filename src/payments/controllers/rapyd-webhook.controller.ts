import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { HandleRapydNotificationService } from '../services/handle-rapyd-notification.service';

/**
 * Rapyd calls this directly over plain HTTP, never through `/graphql` — the
 * third REST (non-GraphQL) endpoint in this backend, shaped like
 * `MercadoPagoWebhookController`/`DiditWebhookController`. Public
 * internet-facing: no `SessionGuard` (this is the PROVIDER calling, not a user);
 * its only protection is the HMAC signature check. NOT behind
 * `RapydModuleEnabledGuard` either: a kill switch meant to stop NEW checkouts
 * must not also drop the notification that resolves a payment already in flight.
 *
 * Reads `req.rawBody` (NOT `req.body`): Rapyd's signature covers the exact
 * body string, so it is verified against the literal bytes received, before
 * Express could re-parse/re-serialize them (`main.ts`/`test-app.ts` pass
 * `rawBody: true` to `NestFactory.create()`, same as the Didit webhook).
 *
 * **One route, one URL**: `POST /webhooks/rapyd`. A Rapyd account is
 * multi-country (verified live 2026-09-21: one key pair served Colombia and
 * Argentina), so there is ONE webhook URL in Rapyd's Client Portal and ONE key
 * pair to verify with — no per-country segment. The keys come from
 * `PlatformSetting`, never from anything in the request.
 *
 * **Signed URL behind a proxy**: Rapyd signs the FULL public URL it was told to
 * call. This controller never rebuilds it from the request (behind a
 * proxy/tunnel `req.originalUrl` is the internal path, and the signature would
 * never verify): `HandleRapydNotificationService.isSignatureValid` derives it
 * from the configured public base URL
 * (`payments.general-settings.callbacks.public-base-url` + `/webhooks/rapyd`), which must equal
 * the URL entered in the Client Portal.
 *
 * Responses: a plain `{ received: true }` on success or on any "nothing to do"
 * outcome (including an unparseable body under a VALID signature, so Rapyd does
 * not retry it forever); a generic 401 (never disclosing WHY) on a bad or
 * missing signature, or when the keys/public URL are not configured. Genuine
 * processing failures are left to surface as a 5xx ON PURPOSE so Rapyd retries
 * the delivery.
 *
 * Throttling: the base `ThrottlerGuard` with its own limit, same as the other
 * webhooks — the app-wide GraphQL throttler no-ops for a non-GraphQL context.
 */
@Controller('webhooks/rapyd')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class RapydWebhookController {
  private readonly logger = new Logger(RapydWebhookController.name);

  constructor(
    private readonly handleRapydNotificationService: HandleRapydNotificationService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody?.toString('utf8') ?? '';

    const signatureValid =
      await this.handleRapydNotificationService.isSignatureValid({
        signature: headers['signature'],
        salt: headers['salt'],
        timestamp: headers['timestamp'],
        rawBody,
      });
    if (!signatureValid) {
      // A generic 401 — never reveals whether a header was missing, the HMAC
      // wrong, or the keys/public URL are not configured.
      this.logger.warn({
        event: 'rapyd_webhook_received',
        signatureValid: false,
      });
      throw new UnauthorizedException();
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      this.logger.warn({ event: 'rapyd_webhook_malformed_body' });
      return { received: true };
    }

    await this.handleRapydNotificationService.execute({ payload });
    return { received: true };
  }
}
