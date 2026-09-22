import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { MercadoPagoPaymentAdapter } from './adapters/mercadopago-payment.adapter';
import { RapydPaymentAdapter } from './adapters/rapyd-payment.adapter';
import { CardPaymentAccessService } from './card-payment-access.service';
import { PaymentAttemptRepository } from './payment-attempt.repository';
import { CardPaymentResolver } from './card-payment.resolver';
import { WalletPaymentResolver } from './wallet-payment.resolver';
import { RapydCheckoutResolver } from './rapyd-checkout.resolver';
import { PaymentOptionsResolver } from './payment-options.resolver';
import { MercadoPagoWebhookController } from './controllers/mercadopago-webhook.controller';
import { RapydWebhookController } from './controllers/rapyd-webhook.controller';
import { CardPaymentModuleEnabledGuard } from './guards/card-payment-module-enabled.guard';
import { MercadoPagoWalletModuleEnabledGuard } from './guards/mercadopago-wallet-module-enabled.guard';
import { RapydModuleEnabledGuard } from './guards/rapyd-module-enabled.guard';
import { RapydSavedCardsEnabledGuard } from './guards/rapyd-saved-cards-enabled.guard';
import { SavedCardRepository } from './saved-card.repository';
import { SavedCardResolver } from './saved-card.resolver';
import { DeleteSavedCardService } from './services/delete-saved-card.service';
import { ListMySavedCardsService } from './services/list-my-saved-cards.service';
import { PayEngagementWithSavedCardService } from './services/pay-engagement-with-saved-card.service';
import { RapydSavedCardsCustomerService } from './services/rapyd-saved-cards-customer.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { AbandonEngagementPaymentAttemptService } from './services/abandon-engagement-payment-attempt.service';
import { ApplyPaymentResultService } from './services/apply-payment-result.service';
import { GetAvailablePaymentMethodsService } from './services/get-available-payment-methods.service';
import { HandleRapydNotificationService } from './services/handle-rapyd-notification.service';
import { StartEngagementRapydCheckoutService } from './services/start-engagement-rapyd-checkout.service';
import { GetMyEngagementPaymentAttemptService } from './services/get-my-engagement-payment-attempt.service';
import { HandleMercadoPagoNotificationService } from './services/handle-mercadopago-notification.service';
import { PayEngagementWithCardService } from './services/pay-engagement-with-card.service';
import { ReadAttemptProviderStateService } from './services/read-attempt-provider-state.service';
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
 * GOS-146: the single `PaymentProviderPort` binding is gone. Providers are
 * looked up by `PaymentMethod` through the EXPORTED `PaymentProviderRegistry`
 * (see `ports/payment-provider.port.ts` for the capability model); a future
 * provider is one new adapter class + one line in the registry.
 *
 * **GOS-146 (Rapyd + multi-provider) additions**: `RapydPaymentAdapter` and the
 * capability-based `PaymentProviderRegistry`; `RapydCheckoutResolver`
 * (`startEngagementRapydCheckout`, behind its own `RapydModuleEnabledGuard`,
 * seeded OFF and independent of Mercado Pago's flags), `PaymentOptionsResolver`
 * (`availablePaymentMethods`, `abandonEngagementPaymentAttempt`) and
 * `RapydWebhookController` (`POST /webhooks/rapyd/:country`) — all declared in
 * THIS SAME module, for the same no-resolver-bearing-module-import reason.
 *
 * **GOS-146 saved cards**: `SavedCardResolver` (`mySavedCards`,
 * `payEngagementWithSavedCard`, `deleteSavedCard`), `SavedCardRepository`, its
 * services and `RapydSavedCardsEnabledGuard` (a feature switch of the Rapyd
 * method, seeded OFF) — again in THIS module.
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
  controllers: [MercadoPagoWebhookController, RapydWebhookController],
  providers: [
    CardPaymentResolver,
    WalletPaymentResolver,
    RapydCheckoutResolver,
    PaymentOptionsResolver,
    SavedCardResolver,
    SavedCardRepository,
    RapydSavedCardsEnabledGuard,
    RapydSavedCardsCustomerService,
    ListMySavedCardsService,
    PayEngagementWithSavedCardService,
    DeleteSavedCardService,
    PaymentAttemptRepository,
    CardPaymentAccessService,
    CardPaymentModuleEnabledGuard,
    MercadoPagoWalletModuleEnabledGuard,
    RapydModuleEnabledGuard,
    EngagementsRepository,
    MercadoPagoPaymentAdapter,
    RapydPaymentAdapter,
    PaymentProviderRegistry,
    ReadAttemptProviderStateService,
    ApplyPaymentResultService,
    PayEngagementWithCardService,
    StartEngagementWalletPaymentService,
    GetMyEngagementPaymentAttemptService,
    HandleMercadoPagoNotificationService,
    StartEngagementRapydCheckoutService,
    AbandonEngagementPaymentAttemptService,
    GetAvailablePaymentMethodsService,
    HandleRapydNotificationService,
  ],
  exports: [PaymentProviderRegistry, PaymentAttemptRepository],
})
export class PaymentsModule {}
