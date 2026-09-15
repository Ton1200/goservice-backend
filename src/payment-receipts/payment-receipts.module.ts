import { Module } from '@nestjs/common';
import '../ledger/models/ledger-entry-type.enum'; // GraphQL enum registration side effect — needed on the consumer schema too now
import { AuthModule } from '../auth/auth.module';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { PaymentReceiptsResolver } from './payment-receipts.resolver';
import { ListMyPaymentReceiptsService } from './services/list-my-payment-receipts.service';

/**
 * 2026-09-14 follow-up (human-requested) — `myPaymentReceipts`, a
 * consumer-facing, read-only view over the SAME `LedgerEntry` table
 * `adminLedgerEntries` already audits — "does a User have a trace of every
 * payment/comprobante involving them" from their own side, not just the
 * admin's.
 *
 * Imports: `AuthModule` for `SessionGuard`; `IdentityVerificationModule` for
 * `AccountApprovedGuard`; `UsersModule` directly too (same reasoning as
 * every other consumer module's own header comment: `AccountApprovedGuard`
 * needs `UsersRepository` resolvable from THIS module's injector);
 * `ProfilesModule` for `ProfilesRepository`; `LedgerModule` (deliberately
 * resolver-free, safe to import directly) for `LedgerRepository`.
 *
 * This is a NEW module in the public `/graphql` schema's own `include`
 * array (`app.module.ts`) — `LedgerModule` itself stays out of that array,
 * same "resolver lives in the module actually listed in `include`,
 * dependencies are reused as concrete providers/imported resolver-free
 * modules" convention every other consumer module here follows.
 */
@Module({
  imports: [
    AuthModule,
    IdentityVerificationModule,
    LedgerModule,
    ProfilesModule,
    UsersModule,
  ],
  providers: [PaymentReceiptsResolver, ListMyPaymentReceiptsService],
})
export class PaymentReceiptsModule {}
