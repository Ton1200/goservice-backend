/**
 * GOS-123 — how many hours after `Engagement.completedAt` the Engagement
 * Chat stays writable before becoming read-only for good. Admin-editable
 * (seeded in `prisma/seed.ts`, listed in `admin-panel/js/settings.js`'s
 * `KNOWN_SETTING_SLOTS`), read fresh on every call — never cached, so a
 * change in the admin applies without a deploy.
 */
export const CHAT_POST_COMPLETION_WINDOW_HOURS_KEY =
  'customer.chat.post-completion-window-hours';

/**
 * Fallback used when the setting above is missing or unparseable — the
 * product decision for GOS-123 is "use 48", NOT fail closed (unlike
 * `mapsSearchMisconfigured()`): a missing seed must never silently lock
 * every completed Engagement's chat, nor keep it open forever.
 */
export const DEFAULT_CHAT_POST_COMPLETION_WINDOW_HOURS = 48;
