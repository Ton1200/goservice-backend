import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { CashPaymentAccessService } from './cash-payment-access.service';
import { CashPaymentRepository } from './cash-payment.repository';
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
 * `EngagementsRepository` is reused here as a CONCRETE provider class (same
 * "reuse the concrete repository class, never the resolver-bearing module"
 * pattern `AppointmentsModule` already establishes for the exact same
 * repository) — `src/cash-payment/` never imports `EngagementsModule`
 * itself. `src/cash-payment/` NEVER writes the `Engagement` table directly —
 * every write to it goes through this reused `EngagementsRepository`
 * instance's own `setPaymentMethodIfUnset`.
 *
 * `exports: [CashPaymentRepository]` — for `src/platform-admin/cash-payment/`'s
 * reuse, same "reuse the concrete repository class directly" pattern
 * `AppointmentsModule`/`ReviewsModule` already establish for their own admin
 * audit-surface siblings.
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
    CashPaymentRepository,
    CashPaymentAccessService,
    CashPaymentModuleEnabledGuard,
    EngagementsRepository,
    ConfirmCashPaymentService,
    GetMyCashPaymentConfirmationService,
    GetMyPendingCashCommissionDebtService,
  ],
  exports: [CashPaymentRepository],
})
export class CashPaymentModule {}
