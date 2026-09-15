import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { LedgerEntryType } from '../../ledger/models/ledger-entry-type.enum';

/**
 * 2026-09-14 follow-up (human-requested) — `myPaymentReceipts`'s
 * consumer-facing item type: the "comprobante interno" (internal receipt)
 * for a `LedgerEntry` row the caller is a party to. A DELIBERATELY SEPARATE
 * GraphQL type from `AdminLedgerEntry` — same "never reuse an Admin-prefixed
 * type on the public schema" discipline this codebase's isolated-schema
 * design already establishes (see ADR 0005's isolation rationale) — even
 * though the two are a near-identical 1:1 field mirror today.
 *
 * `LedgerEntryType` is reused unchanged from `src/ledger/models/` — the
 * SAME enum already registered (as a GraphQL side effect) for the admin
 * schema; sharing one enum name across both schemas is an established
 * precedent in this codebase (e.g. `CountryCode`).
 */
@ObjectType('PaymentReceipt')
export class PaymentReceiptModel {
  @Field(() => ID)
  id!: string;

  // Human-facing sequential number ("Pago #00000000001") — one per ROW, see
  // `LedgerEntry.receiptNumber`'s own schema comment. Zero-padding is a
  // display concern, left to whichever client renders it.
  @Field(() => Int)
  receiptNumber!: number;

  @Field(() => LedgerEntryType)
  type!: LedgerEntryType;

  @Field(() => Int)
  amount!: number;

  @Field(() => String)
  currency!: string;

  @Field(() => ID, { nullable: true })
  engagementId!: string | null;

  @Field(() => Int, { nullable: true })
  commissionPercentApplied!: number | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
