import { Engagement, EngagementStatus } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  CHAT_POST_COMPLETION_WINDOW_HOURS_KEY,
  DEFAULT_CHAT_POST_COMPLETION_WINDOW_HOURS,
} from '../constants/engagement-chat-setting-keys.constants';

export interface EngagementChatClosure {
  chatReadOnly: boolean;
  chatClosesAt: Date | null;
}

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * GOS-123 — reads `customer.chat.post-completion-window-hours` fresh on
 * every call (no cache, so an admin change applies without a deploy).
 * Missing, non-numeric or negative values fall back to
 * `DEFAULT_CHAT_POST_COMPLETION_WINDOW_HOURS` — see that constant's own
 * comment for why this doesn't fail closed. `0` is valid: the chat closes
 * the moment the Engagement is completed.
 */
export async function readPostCompletionWindowHours(
  platformSettingPort: PlatformSettingPort,
): Promise<number> {
  const raw = await platformSettingPort.getValue(
    CHAT_POST_COMPLETION_WINDOW_HOURS_KEY,
  );
  const hours = raw === null || raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(hours) || hours < 0) {
    return DEFAULT_CHAT_POST_COMPLETION_WINDOW_HOURS;
  }
  return hours;
}

/**
 * GOS-123 — the ONE place deciding whether an Engagement's chat is
 * read-only. Shared by `SendEngagementMessageService` (enforcement) and
 * `EngagementChatClosureFieldResolver` (`Engagement.chatReadOnly`/
 * `chatClosesAt`), so what the client is told can never drift from what
 * the backend actually enforces.
 *
 * - `CANCELLED` → read-only immediately, no closing time.
 * - `COMPLETED` → writable until `completedAt + windowHours`, read-only
 *   from that instant on (inclusive).
 * - any other status → writable, no closing time.
 *
 * A `COMPLETED` row without `completedAt` (only possible for rows completed
 * before GOS-121 stamped that column) is treated as already closed — there
 * is no instant to count the window from.
 */
export function resolveEngagementChatClosure(
  engagement: Pick<Engagement, 'status' | 'completedAt'>,
  windowHours: number,
  now: Date,
): EngagementChatClosure {
  if (engagement.status === EngagementStatus.CANCELLED) {
    return { chatReadOnly: true, chatClosesAt: null };
  }
  if (engagement.status === EngagementStatus.COMPLETED) {
    if (!engagement.completedAt) {
      return { chatReadOnly: true, chatClosesAt: null };
    }
    const chatClosesAt = new Date(
      engagement.completedAt.getTime() + windowHours * MS_PER_HOUR,
    );
    return {
      chatReadOnly: now.getTime() >= chatClosesAt.getTime(),
      chatClosesAt,
    };
  }
  return { chatReadOnly: false, chatClosesAt: null };
}
