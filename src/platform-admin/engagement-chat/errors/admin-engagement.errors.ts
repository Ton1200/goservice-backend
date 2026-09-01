import { DomainException } from '../../../common/errors/domain-exception';

const NOT_FOUND_CODE = 'ADMIN_ENGAGEMENT_NOT_FOUND';

/**
 * Thrown by `GetAdminEngagementChatThreadService` when `engagementId`
 * doesn't resolve to a real `Engagement`. Same reasoning as
 * `adminQuoteNotFound()`: this is an internal admin tool, the caller is
 * already authenticated, and there is no enumeration risk to protect
 * against here.
 */
export function adminEngagementNotFound(id: string): DomainException {
  return new DomainException(
    NOT_FOUND_CODE,
    `No Engagement exists with id "${id}".`,
  );
}
