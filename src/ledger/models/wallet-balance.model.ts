import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('WalletBalance', {
  description:
    "One currency's slice of the authenticated Professional's wallet. Amounts are whole currency units (no minor units).",
})
export class WalletBalanceModel {
  @Field({
    description:
      'ISO 4217 currency code of every amount in this row (ARS, COP). Comes from the ledger rows themselves, never guessed.',
  })
  currency!: string;

  @Field(() => Int, {
    description:
      'Net digital credits minus cash commission debt, in this currency only. Available immediately (no holdback). Can be negative.',
  })
  balance!: number;

  @Field(() => Int, {
    description:
      'Cash commission owed to GoService in this currency. Already subtracted inside balance — never subtract it again.',
  })
  pendingCashCommissionDebt!: number;
}
