import { Field, ID, InputType } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * `adminCashPaymentConfirmations`'s optional filter — mirrors
 * `AdminLedgerEntriesFilterInput`'s `engagementId` field, plus `onlyPending`
 * (this ticket's own AC: "expone las CashPaymentConfirmation en sí,
 * incluyendo las que tienen solo una de las dos fechas seteadas").
 */
@InputType()
export class AdminCashPaymentConfirmationsFilterInput {
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID('4')
  engagementId?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  onlyPending?: boolean;
}
