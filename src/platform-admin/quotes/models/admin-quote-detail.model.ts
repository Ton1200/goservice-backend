import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { QuoteStatus } from '../../../quotes/models/quote-status.enum';
import { AdminQuoteEngagementModel } from './admin-quote-engagement.model';
import { AdminQuoteProfessionalModel } from './admin-quote-professional.model';
import { AdminQuoteServiceRequestModel } from './admin-quote-service-request.model';

/**
 * Admin-facing GraphQL type for `quoteDetail` (`/admin/graphql` only),
 * gated by the SAME `Permission.QUOTES_READ` as `quotes` — no new
 * permission for this read-only detail view, same convention
 * `serviceRequestDetail` already established. Deliberately a SEPARATE type
 * from `AdminQuoteModel` (the grid-row shape), carrying the linked
 * `engagement` (nullable — only set once this Quote was actually accepted).
 */
@ObjectType('AdminQuoteDetail')
export class AdminQuoteDetailModel {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  price!: number;

  @Field()
  message!: string;

  @Field(() => QuoteStatus)
  status!: QuoteStatus;

  @Field(() => AdminQuoteServiceRequestModel)
  serviceRequest!: AdminQuoteServiceRequestModel;

  @Field(() => AdminQuoteProfessionalModel)
  professional!: AdminQuoteProfessionalModel;

  @Field(() => AdminQuoteEngagementModel, { nullable: true })
  engagement!: AdminQuoteEngagementModel | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
