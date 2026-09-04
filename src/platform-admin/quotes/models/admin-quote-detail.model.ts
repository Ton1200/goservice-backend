import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { QuoteAttachmentModel } from '../../../quotes/models/quote-attachment.model';
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

  // GOS-53 (Quote Negotiation) admin follow-up — see
  // `AdminQuoteModel.negotiatedPrice`'s own comment.
  @Field(() => Int, { nullable: true })
  negotiatedPrice?: number | null;

  // GOS-53 follow-up — see `AdminQuoteModel.finalPrice`'s own comment.
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

  // GOS-53 admin follow-up — see `AdminQuoteModel.negotiationMessageCount`'s
  // own comment.
  @Field(() => Int)
  negotiationMessageCount!: number;

  @Field(() => AdminQuoteEngagementModel, { nullable: true })
  engagement!: AdminQuoteEngagementModel | null;

  // GOS-72 — the Quote's reference images. Reuses the consumer
  // `QuoteAttachment` type directly ("orphaned type made reachable" — same
  // pattern as `AdminServiceRequestDetailModel.attachments`); gated by the
  // existing `QUOTES_READ`, no new permission — the image inherits its
  // owning Quote's access rules.
  @Field(() => [QuoteAttachmentModel])
  attachments!: QuoteAttachmentModel[];

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
