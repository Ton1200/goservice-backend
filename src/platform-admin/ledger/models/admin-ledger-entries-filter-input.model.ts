import { Field, GraphQLISODateTime, ID, InputType } from '@nestjs/graphql';
import { IsDate, IsOptional, IsUUID } from 'class-validator';

/**
 * `adminLedgerEntries`'s optional filter — mirrors `AdminReviewsFilterInput`
 * field-for-field where applicable (`engagementId`/`professionalProfileId`),
 * plus a `from`/`to` created-at date range (this ticket's own AC scope —
 * "cada evento", auditable by time window). `@IsDate()` on `from`/`to`
 * mirrors `ProposeAppointmentInput.startsAt`/`endsAt`'s own precedent: the
 * `GraphQLISODateTime` scalar parses the wire ISO-8601 string into a real
 * JS `Date` BEFORE this DTO is validated, so `@IsDate()` sees an actual
 * `Date` instance, not the raw string.
 */
@InputType()
export class AdminLedgerEntriesFilterInput {
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID('4')
  engagementId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID('4')
  professionalProfileId?: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  @IsOptional()
  @IsDate()
  from?: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  @IsOptional()
  @IsDate()
  to?: Date;
}
