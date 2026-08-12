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
// resetting `session.js`'s in-memory `currentToken` to `null` before the
// destination document's bootstrap script ever ran, which then saw
// `isLoggedIn() === false` and bounced straight back to the login page.
// Switching sections via `hidden` (this module) instead of navigating keeps
// the `session.js` module instance alive across login, while a REAL
// full-page reload (F5, closing/reopening the tab) still discards it
// exactly as designed (see ADR 0005) — only the login->dashboard
// transition itself stops being a navigation.
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
