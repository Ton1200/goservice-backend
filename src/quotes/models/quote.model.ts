import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { EngagementModel } from '../../engagements/models/engagement.model';
import { ProfessionalProfile } from '../../profiles/models/professional-profile.model';
import { QuoteAttachmentModel } from './quote-attachment.model';
import { QuoteStatus } from './quote-status.enum';

/**
 * A Professional's offer against one OPEN ServiceRequest — GOS-41.
 * `professionalProfile` is a plain `@Field()` (not a `@ResolveField`, no
 * separate field resolver) — `QuotesRepository` always includes it in the
 * same query (see that repository's `QUOTE_INCLUDE`), and exposing a
 * Professional's own public profile to a Customer reviewing Quotes is not a
 * privacy leak the way exposing precise location would be (neither profile
 * carries a precise-location field at all today — see
 * `goservice-docs/decisions/DEC-005-location-and-proximity.md`).
 */
@ObjectType('Quote')
export class QuoteModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  serviceRequestId!: string;

  @Field(() => ID)
  professionalProfileId!: string;

  @Field(() => ProfessionalProfile)
  professionalProfile!: ProfessionalProfile;

  @Field(() => Int)
  price!: number;

  // GOS-53 — set only by `AcceptQuotePriceProposalService`, when a
  // negotiated `QuotePriceProposal` is accepted. `price` (the original
  // quoted price, above) is never overwritten — see that field's own
  // schema comment for why this is a separate, additive column.
  @Field(() => Int, { nullable: true })
  negotiatedPrice?: number | null;

  @Field()
  message!: string;

  @Field(() => QuoteStatus)
  status!: QuoteStatus;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => EngagementModel, { nullable: true })
  engagement?: EngagementModel | null;

  // GOS-72 — reference images the Professional attached via
  // `addQuoteAttachment`. A plain `@Field()` (not a `@ResolveField`) —
  // `QuotesRepository` always includes it in the same query (see
  // `QUOTE_INCLUDE`), same pattern as `professionalProfile`/`engagement`
  // above. Empty array when none were attached.
  @Field(() => [QuoteAttachmentModel])
  attachments!: QuoteAttachmentModel[];
}
