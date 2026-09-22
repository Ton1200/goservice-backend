import { Field, ID, InputType } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * `adminPaymentAttempts`'s optional filter — `engagementId` narrows to one
 * Engagement; `onlyPending` (default-shaped like the pre-generalization
 * `adminCashPaymentConfirmations` filter it replaces) narrows to PENDING or
 * REJECTED attempts, whatever their method — the in-flight/failed cases
 * `adminEngagementPaymentSummaries` (ledger-derived) structurally cannot
 * show, since a payment with no ledger entries never appears there.
 */
@InputType()
export class AdminPaymentAttemptsFilterInput {
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID('4')
  engagementId?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  onlyPending?: boolean;
}
