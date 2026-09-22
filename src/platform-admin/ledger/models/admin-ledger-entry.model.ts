import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { LedgerEntryType } from '../../../ledger/models/ledger-entry-type.enum';

/**
 * Admin-facing GraphQL type for `adminLedgerEntries` (`/admin/graphql`
 * only), gated by `Permission.LEDGER_READ`. A straight 1:1 mirror of the
 * underlying `LedgerEntry` row — nothing is redacted for this audience,
 * same posture as `AdminReviewModel`. `engagementId`/`customerProfileId`/
 * `professionalProfileId` are all nullable, matching the underlying
 * `onDelete: SetNull` columns (see `LedgerEntry`'s own header comment in
 * `prisma/schema.prisma`) — a deleted party's past ledger history survives,
 * anonymized.
 */
@ObjectType('AdminLedgerEntry')
export class AdminLedgerEntryModel {
  @Field(() => ID)
  id!: string;

  // 2026-09-14 follow-up (human-requested) — the human-facing "comprobante
  // interno" sequential number ("Pago #00000000001"). One per ROW, not per
  // compound event — see `LedgerEntry.receiptNumber`'s own schema comment.
  // Zero-padding for display is a formatting concern, left to whichever
  // client renders it (the admin panel pads to 11 digits — see
  // `admin-panel/js/payments.js`).
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

  @Field(() => ID, { nullable: true })
  customerProfileId!: string | null;

  @Field(() => ID, { nullable: true })
  professionalProfileId!: string | null;

  @Field(() => Int, { nullable: true })
  commissionPercentApplied!: number | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
