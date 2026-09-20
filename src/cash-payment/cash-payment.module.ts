import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentAttemptRepository } from '../payments/payment-attempt.repository';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { CashPaymentAccessService } from './cash-payment-access.service';
import { CashPaymentResolver } from './cash-payment.resolver';
import { CashPaymentModuleEnabledGuard } from './guards/cash-payment-module-enabled.guard';
import { ConfirmCashPaymentService } from './services/confirm-cash-payment.service';
import { GetMyCashPaymentConfirmationService } from './services/get-my-cash-payment-confirmation.service';
import { GetMyPendingCashCommissionDebtService } from './services/get-my-pending-cash-commission-debt.service';

/**
 * GOS-87 — Pago en Efectivo, same infra-only-module skeleton as
 * `src/appointments/`. `PrismaModule` (`src/prisma/`) is `@Global()`, so
 * `PrismaService` doesn't need to be imported here explicitly.
 *
 * Imports: `AuthModule` for `SessionGuard`; `IdentityVerificationModule` for
 * `AccountApprovedGuard`; `UsersModule` directly too (same reasoning as
 * `AppointmentsModule`'s own header comment: `AccountApprovedGuard` needs
 * `UsersRepository` resolvable from THIS module's injector, not only
 * `IdentityVerificationModule`'s own); `ProfilesModule` for
 * `ProfilesRepository`; `PlatformSettingsModule` for
 * `CashPaymentModuleEnabledGuard`'s `PlatformSettingPort`; `LedgerModule`
 * for `RecordCashCommissionDebtService` (deliberately resolver-free, safe to
 * import directly — same reasoning `EngagementsModule` documents for its own
 * `LedgerModule` import).
 *
 * `EngagementsRepository`/`PaymentAttemptRepository` are reused here as
 * CONCRETE provider classes (same "reuse the concrete repository class,
 * never the resolver-bearing module" pattern `AppointmentsModule` already
 * establishes) — `src/cash-payment/` never imports `EngagementsModule` or
 * `PaymentsModule` itself. Cash lives in `PaymentAttempt` together with
 * every other payment method (2026-09-18) — `CashPaymentRepository`/
 * `CashPaymentConfirmation` no longer exist; every persistence call here
 * goes through the shared `PaymentAttemptRepository`.
 * `src/cash-payment/` NEVER writes the `Engagement` table directly — every
 * write to it goes through the reused `EngagementsRepository` instance's own
 * `setPaymentMethodIfUnset`.
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
  providers: [
    CashPaymentResolver,
    PaymentAttemptRepository,
    CashPaymentAccessService,
    CashPaymentModuleEnabledGuard,
    EngagementsRepository,
    ConfirmCashPaymentService,
    GetMyCashPaymentConfirmationService,
    GetMyPendingCashCommissionDebtService,
  ],
})
export class CashPaymentModule {}
