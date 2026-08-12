// GOS-30/31/32 — in-memory-only session token holder. Deliberately NO
// localStorage/sessionStorage/cookie: a full page reload always logs the
// admin out. This minimizes residual token exposure in a tool that manages
// feature flags and encrypted third-party credentials — see the
// platform-admin plan's "Thin GraphQL client" section.
//
// A plain module-scope variable, not a class/object with methods that could
// be called from outside this file's own functions — every other script
// (`login.js`, `settings.js`, `graphqlClient.js`) goes through the
// three exported functions below, never touches the variable directly.
let currentToken = null;
let currentAdminUserId = null;
let currentEmail = null;
let currentDisplayName = null;

export function saveSession({ sessionToken, adminUserId, email, displayName }) {
  currentToken = sessionToken;
  currentAdminUserId = adminUserId;
  currentEmail = email;
  currentDisplayName = displayName;
}

export function getSessionToken() {
  return currentToken;
}

export function getAdminUserId() {
  return currentAdminUserId;
}

// Read by the header's user-menu dropdown to show which admin is
// connected (GOS-31 follow-up) — populated once, right after a
// successful login (see `js/login.js`), since a full page reload always
// discards the in-memory session and shows the login view first (no
// restore-on-reload case exists).
export function getCurrentAdminIdentity() {
  return { email: currentEmail, displayName: currentDisplayName };
}

export function clearSession() {
  currentToken = null;
  currentAdminUserId = null;
  currentEmail = null;
  currentDisplayName = null;
}

export function isLoggedIn() {
  return currentToken !== null;
}
