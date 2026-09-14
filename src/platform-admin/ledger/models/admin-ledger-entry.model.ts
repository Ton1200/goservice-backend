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
