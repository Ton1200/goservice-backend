import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

/**
 * One reference image attached to a Quote by the submitting Professional
 * (GOS-72). Mirrors `ServiceRequestAttachmentModel` exactly — `order` and
 * `quoteId` are deliberately NOT exposed (the array is already returned in
 * stable order by `QuotesRepository`); `url` is always a URL this backend
 * itself issued via the shared storage layer, never a client-supplied one.
 */
@ObjectType('QuoteAttachment')
export class QuoteAttachmentModel {
  @Field(() => ID)
  id!: string;

  @Field()
  url!: string;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
