// Slice-1 view switcher — toggles between the login section and the
// dashboard (Configuración) section within the single admin-panel document
// `index.html`. No router library, consistent with the plan's "Routing"
// approach; this just applies that same plain-`hidden`-toggling idea to
// auth state too, not only to a future second feature section.
//
// This module exists specifically to fix the GOS-3x login bug: `login.js`
// used to navigate via `window.location.href = 'index.html'` on a
// successful login, but `login.html`/`index.html` were two separate static
// documents — a full navigation always discards the whole JS module graph,
// which back when `session.js` was in-memory-only reset its `currentToken`
// to `null` before the destination document's bootstrap script ever ran.
// Switching sections via `hidden` (this module) instead of navigating
// avoided that. `session.js` is now `localStorage`-backed (2026-08-11
// follow-up) so a real full-page reload no longer discards the session
// either — but this module still exists and is still used for the same
// reason: no router library, plain `hidden`-toggling between login and
// dashboard within the one document.
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');

export function showLoginView() {
  dashboardView.hidden = true;
  loginView.hidden = false;
}

export function showDashboardView() {
  loginView.hidden = true;
  dashboardView.hidden = false;
}
