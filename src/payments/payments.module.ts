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
import { WalletPaymentResolver } from './wallet-payment.resolver';
import { MercadoPagoWebhookController } from './controllers/mercadopago-webhook.controller';
import { CardPaymentModuleEnabledGuard } from './guards/card-payment-module-enabled.guard';
import { MercadoPagoWalletModuleEnabledGuard } from './guards/mercadopago-wallet-module-enabled.guard';
import { PaymentProviderPort } from './ports/payment-provider.port';
import { ApplyPaymentResultService } from './services/apply-payment-result.service';
import { GetMyEngagementPaymentAttemptService } from './services/get-my-engagement-payment-attempt.service';
import { HandleMercadoPagoNotificationService } from './services/handle-mercadopago-notification.service';
import { PayEngagementWithCardService } from './services/pay-engagement-with-card.service';
import { StartEngagementWalletPaymentService } from './services/start-engagement-wallet-payment.service';

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
 *
 * **GOS-142 (wallet payment) additions**: `WalletPaymentResolver`
 * (`startEngagementWalletPayment`/`myEngagementPaymentAttempt`), its own
 * `MercadoPagoWalletModuleEnabledGuard` (seeded OFF, same as Card's) and
 * services — all declared in THIS SAME module, never a new one, so no
 * resolver-bearing module import is ever needed (the rule that caused the
 * earlier admin-schema-isolation leak).
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
    WalletPaymentResolver,
    PaymentAttemptRepository,
    CardPaymentAccessService,
    CardPaymentModuleEnabledGuard,
    MercadoPagoWalletModuleEnabledGuard,
    EngagementsRepository,
    MercadoPagoPaymentAdapter,
    { provide: PaymentProviderPort, useExisting: MercadoPagoPaymentAdapter },
    ApplyPaymentResultService,
    PayEngagementWithCardService,
    StartEngagementWalletPaymentService,
    GetMyEngagementPaymentAttemptService,
    HandleMercadoPagoNotificationService,
  ],
  exports: [PaymentProviderPort, PaymentAttemptRepository],
})
export class PaymentsModule {}
