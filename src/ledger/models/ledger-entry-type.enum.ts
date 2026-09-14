import { registerEnumType } from '@nestjs/graphql';
import { LedgerEntryType } from '@prisma/client';

/**
 * Registers the Prisma-generated `LedgerEntryType` enum directly as a
 * GraphQL enum type — same "GraphQL and persistence shapes are meant to be
 * identical" reasoning as `EngagementReviewParty`/`EngagementChatParty`.
 * Reachable ONLY from the admin schema (`adminLedgerEntries`) — see
 * `platform-admin.module.ts`'s own side-effect import of this file.
 */
registerEnumType(LedgerEntryType, {
  name: 'LedgerEntryType',
  description:
    'The kind of append-only financial ledger row this is. CUSTOMER_CHARGE/CASH_COMMISSION_DEBT/WITHDRAWAL/WITHDRAWAL_HOLD_RELEASE are reserved for future payment/wallet capabilities (GOS-79/80/82) — no writer exists for them yet. CUSTOMER_CANCELLATION_FEE/PLATFORM_COMMISSION/PROFESSIONAL_NET_CREDIT are written together as one cancellation-charge event (GOS-109, DEC-008); REFUND is written alone on a Professional-initiated cancellation.',
});

export { LedgerEntryType };
