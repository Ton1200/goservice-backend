import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

/**
 * One photo/file attached to a `ServiceRequest`. `order`/`serviceRequestId`
 * are deliberately NOT exposed — the GOS-38 contract only needs
 * `id`/`url`/`createdAt`; the array is already returned in stable order by
 * `ServiceRequestsRepository` (see that class's own comment).
 */
@ObjectType()
export class ServiceRequestAttachmentModel {
  @Field(() => ID)
  id!: string;

  @Field()
  url!: string;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
