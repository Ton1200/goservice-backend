import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { MercadoPagoPaymentAdapter } from './adapters/mercadopago-payment.adapter';
import { CardPaymentAccessService } from './card-payment-access.service';
import { PaymentAttemptRepository } from './payment-attempt.repository';
import { CardPaymentResolver } from './card-payment.resolver';
import { MercadoPagoWebhookController } from './controllers/mercadopago-webhook.controller';
import { CardPaymentModuleEnabledGuard } from './guards/card-payment-module-enabled.guard';
import { PaymentProviderPort } from './ports/payment-provider.port';
import { ApplyPaymentResultService } from './services/apply-payment-result.service';
import { HandleMercadoPagoNotificationService } from './services/handle-mercadopago-notification.service';
import { PayEngagementWithCardService } from './services/pay-engagement-with-card.service';

/**
 * GOS-85 — Integración base con Mercado Pago + cobro con tarjeta. A top-level
 * module at the same level as `src/storage/`, `src/cash-payment/` and
 * `src/ledger/`, built on the same skeleton as `CashPaymentModule`.
 * `PrismaModule` is `@Global()`, so `PrismaService` needs no explicit import.
 *
 * Imports: `AuthModule` for `SessionGuard`; `IdentityVerificationModule` +
 * `UsersModule` for `AccountApprovedGuard` (and `UsersRepository`, for the
 * payer's email); `ProfilesModule` for `ProfilesRepository`;
 * `PlatformSettingsModule` for `PlatformSettingPort` (the kill switch, the
 * provider credentials, the webhook secret); `LedgerModule` for
 * `RecordDigitalPaymentService` (deliberately resolver-free, safe to import
 * directly).
 *
 * `EngagementsRepository` is reused as a CONCRETE provider class — same
 * "reuse the concrete repository, never the resolver-bearing module" pattern
 * `CashPaymentModule` establishes. `src/payments/` NEVER writes the
 * `Engagement` or `LedgerEntry` tables itself: `setPaymentMethodIfUnset` and
 * `RecordDigitalPaymentService` are the only doors.
 *
 * `PaymentProviderPort` is bound to `MercadoPagoPaymentAdapter` and EXPORTED,
 * so GOS-83 (saved-card tokenization) reuses the same port instead of building
 * a second one; a future second provider is one new adapter class + this one
 * `useExisting` line.
 *
 * `ThrottlerModule` is registered once at `AppModule` root, so
 * `MercadoPagoWebhookController`'s `ThrottlerGuard` resolves with no import
 * here (same as `IdentityVerificationModule`'s Didit webhook).
 */
@Module({
  imports: [
    AuthModule,
    IdentityVerificationModule,
    LedgerModule,
    PlatformSettingsModule,
    ProfilesModule,
    UsersModule,
  ],
  controllers: [MercadoPagoWebhookController],
  providers: [
    CardPaymentResolver,
    PaymentAttemptRepository,
    CardPaymentAccessService,
    CardPaymentModuleEnabledGuard,
    EngagementsRepository,
    MercadoPagoPaymentAdapter,
    { provide: PaymentProviderPort, useExisting: MercadoPagoPaymentAdapter },
    ApplyPaymentResultService,
    PayEngagementWithCardService,
    HandleMercadoPagoNotificationService,
  ],
  exports: [PaymentProviderPort, PaymentAttemptRepository],
})
export class PaymentsModule {}
