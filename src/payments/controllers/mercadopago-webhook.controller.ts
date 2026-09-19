import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CountryCode } from '@prisma/client';
import type { Request } from 'express';
import { HandleMercadoPagoNotificationService } from '../services/handle-mercadopago-notification.service';

/**
 * Mercado Pago calls this directly over plain HTTP, never through `/graphql` —
 * the second REST (non-GraphQL) endpoint in this backend, deliberately shaped
 * like `DiditWebhookController`. Public internet-facing: no `SessionGuard`
 * (this is the PROVIDER calling, not a user); its only protection is the
 * `x-signature` HMAC check. NOT behind `CardPaymentModuleEnabledGuard` either:
 * a kill switch meant to stop NEW charges must not also drop the notification
 * that resolves a charge already in flight.
 *
 * Mercado Pago's signature manifest is built from the `data.id` QUERY
 * parameter, the `x-request-id` header and a `ts` value — NOT from the body —
 * so unlike the Didit controller this one has no need of `rawBody`.
 *
 * **Per-country route (2026-09-18)**: `POST /webhooks/mercadopago/orders/:country`
 * — each country's Mercado Pago application is configured, in Mercado Pago's
 * own dashboard, to call its OWN URL (`.../orders/co`, `.../orders/ar`, …).
 * This is how the country — and therefore which `webhook-secret` to check —
 * is known BEFORE anything in the notification itself is trusted; nothing in
 * the signed manifest or the body identifies the country on its own. An
 * unrecognized `:country` segment is treated exactly like a bad signature
 * (generic 401) — there is no secret to check it against.
 *
 * Responses: a plain `{ received: true }` on success or on any "nothing to do"
 * outcome; a generic 401 (never disclosing WHY) on a bad signature or an
 * unrecognized country. Genuine processing failures are left to surface as a
 * 5xx ON PURPOSE so Mercado Pago retries the delivery — see
 * `HandleMercadoPagoNotificationService`.
 *
 * Throttling: the base `ThrottlerGuard` with its own limit, same as Didit's —
 * the app-wide GraphQL throttler no-ops for a non-GraphQL context.
 */
@Controller('webhooks/mercadopago')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class MercadoPagoWebhookController {
  private readonly logger = new Logger(MercadoPagoWebhookController.name);

  constructor(
    private readonly handleMercadoPagoNotificationService: HandleMercadoPagoNotificationService,
  ) {}

  @Post('orders/:country')
  @HttpCode(200)
  async handle(
    @Req() req: Request,
    @Param('country') countryParam: string,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<{ received: boolean }> {
    const country = this.resolveCountry(countryParam);
    if (!country) {
      this.logger.warn({
        event: 'mercadopago_webhook_received',
        signatureValid: false,
        reason: 'unrecognized_country',
        countryParam,
      });
      throw new UnauthorizedException();
    }

    const searchParams = new URL(req.originalUrl, 'http://localhost')
      .searchParams;
    const dataId = searchParams.get('data.id');

    const signatureValid =
      await this.handleMercadoPagoNotificationService.isSignatureValid(
        {
          xSignature: headers['x-signature'],
          xRequestId: headers['x-request-id'],
          dataId,
        },
        country,
      );
    if (!signatureValid) {
      // A generic 401 — never reveals whether the header was missing, the HMAC
      // wrong, or no secret is configured.
      this.logger.warn({
        event: 'mercadopago_webhook_received',
        signatureValid: false,
        country,
      });
      throw new UnauthorizedException();
    }

    if (!dataId) {
      this.logger.log({
        event: 'mercadopago_notification_ignored',
        reason: 'no_data_id',
        country,
      });
      return { received: true };
    }

    // The topic: the `type` query param (per Mercado Pago's own example
    // request: `?data.id=…&type=order`), else the body's `type`.
    const bodyType = (req.body as { type?: unknown } | undefined)?.type;
    const type =
      searchParams.get('type') ??
      (typeof bodyType === 'string' ? bodyType : null);

    await this.handleMercadoPagoNotificationService.execute({
      dataId,
      type,
      country,
    });
    return { received: true };
  }

  /** The `:country` route segment, case-insensitively matched against the
   * real `CountryCode` enum — never trusted as-is. */
  private resolveCountry(countryParam: string): CountryCode | null {
    const upper = countryParam.toUpperCase();
    return (Object.values(CountryCode) as string[]).includes(upper)
      ? (upper as CountryCode)
      : null;
  }
}
