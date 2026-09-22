import { Module } from '@nestjs/common';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { ProfilesRepository } from '../profiles/profiles.repository';
import { UsersRepository } from '../users/users.repository';
import { LedgerRepository } from './ledger.repository';
import { GetMyPaymentBalanceService } from './services/get-my-payment-balance.service';
import { RecordCashCommissionDebtService } from './services/record-cash-commission-debt.service';
import { RecordCustomerCancellationChargeService } from './services/record-customer-cancellation-charge.service';
import { RecordDigitalPaymentService } from './services/record-digital-payment.service';
import { RecordProfessionalCancellationRefundService } from './services/record-professional-cancellation-refund.service';

/**
 * GOS-109 — a lean, resolver-free leaf module, mirroring
 * `QuoteNegotiationRepository`'s own "the ONLY place that issues Prisma
 * queries for this table" convention, one level up: `LedgerRepository`
 * plus the application services that write through it
 * (`RecordCustomerCancellationChargeService`/
 * `RecordProfessionalCancellationRefundService`), all exported for reuse by
 * `EngagementsModule` (the two cancellation services) and
 * `PlatformAdminModule` (`adminLedgerEntries`, read-only — reuses
 * `LedgerRepository` directly, same "reuse the concrete provider class
 * directly, never import a resolver-bearing module" pattern this codebase
 * establishes everywhere; this module has no resolver of its own to leak).
 *
 * `PlatformSettingsModule` is imported for `PlatformSettingPort` alone —
 * same reason `AuthModule`/`QuoteNegotiationModule` import it (it is
 * deliberately resolver-free, see that module's own header comment).
 *
 * **GOS-87**: `RecordCashCommissionDebtService` is a third exported service,
 * reused by `CashPaymentModule`'s own `ConfirmCashPaymentService` — same
 * "import this whole resolver-free module directly" reasoning as
 * `EngagementsModule` already establishes for the other two services.
 *
 * **GOS-85**: `RecordDigitalPaymentService` is a fourth exported service,
 * reused by `PaymentsModule`'s own `ApplyPaymentResultService` — same
 * reasoning again.
 *
 * **2026-09-18**: `GetMyPaymentBalanceService` is a fifth exported service
 * (`myPaymentBalance`, `CashPaymentResolver`) — needs `ProfilesRepository`
 * (in turn needs `UsersRepository`), so both are redeclared here as
 * CONCRETE providers rather than importing `ProfilesModule`/`UsersModule` —
 * this module MUST stay resolver-free (its own header line above): both of
 * those modules carry a real `@Resolver()`
 * (`ProfilesResolver`/`UsersResolver`), and `LedgerModule` is reused by
 * `PlatformAdminModule` for the admin schema's `LedgerRepository` access —
 * importing either would leak consumer-facing queries/mutations
 * (`me`/`myAccount`/`register`/…) into `/admin/graphql` (caught live by
 * `admin-schema-isolation.e2e-spec.ts` the first time this was tried with
 * `imports: [..., ProfilesModule]` instead). Both repositories depend only
 * on `PrismaService` (`@Global()`) plus each other, so no module import is
 * needed for either.
 */
@Module({
  imports: [PlatformSettingsModule],
  providers: [
    LedgerRepository,
    RecordCustomerCancellationChargeService,
    RecordProfessionalCancellationRefundService,
    RecordCashCommissionDebtService,
    RecordDigitalPaymentService,
    UsersRepository,
    ProfilesRepository,
    GetMyPaymentBalanceService,
  ],
  exports: [
    LedgerRepository,
    RecordCustomerCancellationChargeService,
    RecordProfessionalCancellationRefundService,
    RecordCashCommissionDebtService,
    RecordDigitalPaymentService,
    GetMyPaymentBalanceService,
  ],
})
export class LedgerModule {}
