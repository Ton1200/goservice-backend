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

  // GOS-53 (Quote Negotiation) admin follow-up — the negotiated price
  // agreed via the Quote Negotiation thread, if any (mirrors
  // `Quote.negotiatedPrice`/the consumer-facing `QuoteModel.negotiatedPrice`
  // — see either's own schema comment). `price` above is never overwritten.
  @Field(() => Int, { nullable: true })
  negotiatedPrice?: number | null;

  // GOS-53 follow-up — the real, effective price (`negotiatedPrice ?? price`,
  // never null). Mirrors the consumer-facing `QuoteModel.finalPrice` — see
  // that field's own `QuoteFieldResolver` comment for the business-rule gap
  // this closes. Computed directly in `toAdminQuoteModel`, not via a
  // separate `@ResolveField()` (this codebase's admin models are already
  // mapped from a Prisma row in a plain function, not resolved field-by-
  // field off a live entity).
  @Field(() => Int)
  finalPrice!: number;

  @Field()
  message!: string;

  @Field(() => QuoteStatus)
  status!: QuoteStatus;

  @Field(() => AdminQuoteServiceRequestModel)
  serviceRequest!: AdminQuoteServiceRequestModel;

  @Field(() => AdminQuoteProfessionalModel)
  professional!: AdminQuoteProfessionalModel;

  // GOS-53 admin follow-up — a cheap, permission-light "is there
  // negotiation activity here" signal (`Quote.negotiationMessages`'
  // `_count`). Reading the actual thread content still requires the
  // separate `Permission.QUOTE_NEGOTIATION_READ`-gated
  // `adminQuoteNegotiationThread` query — this count alone never exposes
  // message content.
  @Field(() => Int)
  negotiationMessageCount!: number;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
