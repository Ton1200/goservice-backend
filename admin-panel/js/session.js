// GOS-30/31/32 — admin session token holder, backed by `localStorage`.
//
// 2026-08-11 follow-up — REVERSES the original in-memory-only design
// (module-scope variable, discarded on every page reload) at explicit
// human request: in real day-to-day use, being logged out by a plain F5 or
// tab close/reopen was disruptive enough that the human asked for the
// session to persist across both. This is a deliberate security trade-off,
// made knowingly, not an oversight:
//   - The original reasoning (minimize how long an admin token — used to
//     manage feature flags and encrypted third-party credentials — sits
//     somewhere retrievable in the browser) still applies; `localStorage`
//     is more exposed than an in-memory variable (survives page reloads,
//     browser restarts, and is readable by any script that can run in this
//     origin, same caveat any `localStorage` use always carries).
//   - The stored token is still bounded by `ADMIN_SESSION_TTL_MINUTES`
//     (backend-enforced, default 30 minutes) — persisting it client-side
//     does NOT extend how long it's actually valid; an expired token found
//     in `localStorage` on load still gets rejected by the backend
//     (`ADMIN_UNAUTHENTICATED`) exactly as before, at which point
//     `handleAdminUnauthenticated` (see `settings.js`/`userAccounts.js`)
//     already clears it and bounces to the login view — no new logic
//     needed there.
//   - `clearSession()` (logout) still wipes it immediately, same as before.
//
// Every other script (`login.js`, `settings.js`, `userAccountS.js`,
// `graphqlClient.js`, `bootstrap.js`) goes through the exported functions
// below, never touches `localStorage` directly.
const STORAGE_KEY = 'goservice-admin-session';

function readStoredSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.sessionToken !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    // Corrupted/tampered value — treat exactly like "no session", never throw.
    return null;
  }
}

export function saveSession({ sessionToken, adminUserId, email, displayName }) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ sessionToken, adminUserId, email, displayName }),
  );
}

export function getSessionToken() {
  return readStoredSession()?.sessionToken ?? null;
}

export function getAdminUserId() {
  return readStoredSession()?.adminUserId ?? null;
}

// Read by the header's user-menu dropdown to show which admin is
// connected (GOS-31 follow-up) — now also correctly populated right after
// a page reload (not just right after login), since the underlying data
// survives in `localStorage`.
export function getCurrentAdminIdentity() {
  const stored = readStoredSession();
  return { email: stored?.email ?? null, displayName: stored?.displayName ?? null };
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isLoggedIn() {
  return getSessionToken() !== null;
}
