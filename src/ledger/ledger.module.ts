import { Module } from '@nestjs/common';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { LedgerRepository } from './ledger.repository';
import { RecordCustomerCancellationChargeService } from './services/record-customer-cancellation-charge.service';
import { RecordProfessionalCancellationRefundService } from './services/record-professional-cancellation-refund.service';

/**
 * GOS-109 — a lean, resolver-free leaf module, mirroring
 * `QuoteNegotiationRepository`'s own "the ONLY place that issues Prisma
 * queries for this table" convention, one level up: `LedgerRepository`
 * plus the two application services that write through it
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
 */
@Module({
  imports: [PlatformSettingsModule],
  providers: [
    LedgerRepository,
    RecordCustomerCancellationChargeService,
    RecordProfessionalCancellationRefundService,
  ],
  exports: [
    LedgerRepository,
    RecordCustomerCancellationChargeService,
    RecordProfessionalCancellationRefundService,
  ],
})
export class LedgerModule {}
