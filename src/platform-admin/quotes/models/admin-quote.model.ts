import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { QuoteStatus } from '../../../quotes/models/quote-status.enum';
import { AdminQuoteProfessionalModel } from './admin-quote-professional.model';
import { AdminQuoteServiceRequestModel } from './admin-quote-service-request.model';

/**
 * Admin-facing GraphQL type for `quotes` (`/admin/graphql` only — never the
 * consumer schema), gated by `Permission.QUOTES_READ`. Grid-row shape —
 * deliberately lighter than `AdminQuoteDetailModel` (no `engagement`), same
 * grid-vs-detail split `AdminServiceRequestModel`/`AdminServiceRequestDetailModel`
 * already establish.
 *
 * Reuses `QuoteStatus` directly (same "orphaned type made reachable from an
 * admin field" pattern `AdminServiceRequestModel` already established for
 * `ServiceRequestStatus`/`ServiceRequestUrgency` — `QuoteStatus` was already
 * an orphaned, unreachable type in the admin schema before this field
 * existed, since `quotes/`'s own consumer-facing `QuoteModel` registers it
 * process-wide).
 */
@ObjectType('AdminQuote')
export class AdminQuoteModel {
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

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
