import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_CHAT_CLOSED_CODE = 'ENGAGEMENT_CHAT_CLOSED';

/**
 * GOS-123 — thrown by `SendEngagementMessageService` when the Engagement
 * Chat is read-only: the Engagement is `CANCELLED`, or it is `COMPLETED`
 * and `completedAt + customer.chat.post-completion-window-hours` has
 * already passed (see `resolveEngagementChatClosure`). Reading the thread
 * (`engagementMessages`) is never affected, and neither are lifecycle
 * system messages (`EmitEngagementLifecycleSystemMessageService` writes
 * directly, bypassing this check).
 */
export function engagementChatClosed(): DomainException {
  return new DomainException(
    ENGAGEMENT_CHAT_CLOSED_CODE,
    'This Engagement Chat is closed — it is read-only now.',
  );
}
