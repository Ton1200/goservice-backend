import { Review } from '@prisma/client';
import { AdminReviewModel } from './admin-review.model';

/** Maps a raw `Review` row (as returned by `ReviewsRepository`) to the
 * GraphQL-facing `AdminReviewModel` — a straight 1:1 field copy, since
 * (unlike the public `ReviewModel`) nothing here is redacted for the admin
 * audience. */
export function toAdminReviewModel(row: Review): AdminReviewModel {
  const model = new AdminReviewModel();
  model.id = row.id;
  model.engagementId = row.engagementId;
  model.authorRole = row.authorRole;
  model.rating = row.rating;
  model.comment = row.comment;
  model.commentModerationStatus = row.commentModerationStatus;
  model.moderatedByAdminUserId = row.moderatedByAdminUserId;
  model.moderatedAt = row.moderatedAt;
  model.createdAt = row.createdAt;
  return model;
}
