import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { QuoteStatus } from '../../../quotes/models/quote-status.enum';
import { AdminServiceRequestQuoteProfessionalModel } from './admin-service-request-quote-professional.model';

/**
 * One Quote submitted against a ServiceRequest, as embedded in
 * `AdminServiceRequestDetailModel.quotes` (GOS-53 Quote Negotiation admin
 * follow-up) — the "Cotizaciones" tab of `serviceRequestDetail`'s redesigned
 * detail popup. Deliberately a SEPARATE, leaner type from
 * `AdminQuoteModel`/`AdminQuoteDetailModel` (`platform-admin/quotes/models/`):
 * this is read-only context embedded inside a ServiceRequest's own detail
 * view (no `serviceRequest`/full professional identity needed — the
 * ServiceRequest is already the page the admin is looking at), not the
 * Quotes grid's own row/detail shape.
 *
 * `negotiationMessageCount` is the same cheap, permission-light "is there
 * negotiation activity here" signal `AdminQuoteModel` carries — reading the
 * actual thread still requires opening this Quote from the Quotes grid
 * (gated by `Permission.QUOTE_NEGOTIATION_READ`); this list itself never
 * exposes message content.
 */
@ObjectType('AdminServiceRequestQuote')
export class AdminServiceRequestQuoteModel {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  price!: number;

  @Field(() => Int, { nullable: true })
  negotiatedPrice?: number | null;

  // GOS-53 follow-up — the real, effective price (`negotiatedPrice ?? price`,
  // never null). Mirrors `AdminQuoteModel.finalPrice`/the consumer-facing
  // `QuoteModel.finalPrice` — see either's own comment.
  @Field(() => Int)
  finalPrice!: number;

  @Field(() => QuoteStatus)
  status!: QuoteStatus;

  @Field(() => Int)
  negotiationMessageCount!: number;

  @Field(() => AdminServiceRequestQuoteProfessionalModel)
  professional!: AdminServiceRequestQuoteProfessionalModel;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
