import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { EngagementStatus } from '../../../engagements/models/engagement-status.enum';

/**
 * Minimal `Engagement` summary attached to `quoteDetail` — id/status/
 * createdAt only, matching `QuotesRepository.ADMIN_QUOTE_DETAIL_SELECT`'s
 * own narrow `engagement` select. Deliberately its OWN, separate admin-only
 * type rather than reusing the consumer-facing `EngagementModel`
 * (`src/engagements/models/engagement.model.ts`) directly: that type's
 * fields are all non-nullable (`serviceRequestId`, `quoteId`,
 * `customerProfileId`, `professionalProfileId`, `updatedAt`), which this
 * intentionally-lean select does not fetch — reusing it as-is here would
 * either force a wider (unnecessary) select or leave those fields silently
 * `undefined` at resolve time. This is "was this specific Quote's
 * acceptance actually finalized into an Engagement" — a cheap existence +
 * status check, not a duplicate of the Engagements admin/consumer surface.
 */
@ObjectType('AdminQuoteEngagement')
export class AdminQuoteEngagementModel {
  @Field(() => ID)
  id!: string;

  @Field(() => EngagementStatus)
  status!: EngagementStatus;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
