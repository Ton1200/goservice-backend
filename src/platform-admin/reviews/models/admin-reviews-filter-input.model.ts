import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ReviewCommentModerationStatus } from '../../../reviews/models/review-comment-moderation-status.enum';

/**
 * `adminReviews`'s optional filter — the FIRST real server-side filter
 * argument anywhere in `platform-admin` (every other admin grid so far is
 * limit/offset-only, with client-side filtering on the fetched page — see
 * `AdminServiceRequestsPageModel`'s own comment). Introduced here
 * specifically because the ticket calls for it: an admin auditing/moderating
 * Reviews needs to narrow by moderation status (e.g. "show me every PENDING
 * comment") without paging through every row client-side.
 */
@InputType()
export class AdminReviewsFilterInput {
  @Field(() => ReviewCommentModerationStatus, { nullable: true })
  @IsOptional()
  @IsEnum(ReviewCommentModerationStatus)
  commentModerationStatus?: ReviewCommentModerationStatus;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID('4')
  engagementId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID('4')
  professionalProfileId?: string;
}
