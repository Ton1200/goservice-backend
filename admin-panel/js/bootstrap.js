// Slice-1 page bootstrap: no router, just this one document's sections
// toggled by `js/view.js` (login<->dashboard) and `js/nav.js` (sidebar
// sections within the dashboard) — see the comment above `<body>` in
// `index.html`. `session.js` is now `localStorage`-backed (2026-08-11
// follow-up — see that file's own header comment for the trade-off), so
// `isLoggedIn()` can genuinely be `true` right after a fresh full-page
// load too, not just after the login->dashboard transition inside
// `login.js` — a stored-but-expired token still gets caught at the first
// real GraphQL request (`handleAdminUnauthenticated` in
// `settings.js`/`userAccounts.js`), which clears it and bounces to login,
// so no extra validate-on-load step is needed here.
//
// Extracted from an inline `<script type="module">...</script>` block that
// used to live directly in `index.html` — moved to this external,
// same-origin file so the app can ship a real Content-Security-Policy
// (`script-src 'self'`) without `'unsafe-inline'`. See
// `src/bootstrap/apply-security-middleware.ts` for the CSP configuration
// this enables.
import { isLoggedIn, clearSession, getCurrentAdminIdentity } from './session.js';
import { graphqlRequest } from './graphqlClient.js';
import { loadSettings } from './settings.js';
import { loadUserAccounts } from './userAccounts.js';
import { loadServiceRequests } from './serviceRequests.js';
import { loadQuotes } from './quotes.js';
import { loadCategories } from './categories.js';
import { loadAdministratorsSection } from './administrators.js';
import { initAcceptInviteView } from './acceptInvite.js';
import { showLoginView, showDashboardView } from './view.js';
import { initNav, showSection } from './nav.js';
import { initialsFor } from './login.js';

initNav({
  'settings-section': loadSettings,
  // GOS-3x follow-up — same "fetch fresh data every time this section is
  // shown" pattern as Configuración above, now that Usuarios is a real,
  // backend-connected grid instead of static mock markup.
  'usuarios-section': loadUserAccounts,
  // GOS-38 follow-up (2026-08-18) — same "fetch fresh data every time this
  // section is shown" pattern.
  'service-requests-section': loadServiceRequests,
  // Quotes admin grid follow-up (2026-08-19) — same "fetch fresh data every
  // time this section is shown" pattern.
  'quotes-section': loadQuotes,
  // Category-tree follow-up (2026-08-18) — same "fetch fresh data every
  // time this section is shown" pattern.
  'categories-section': loadCategories,
  // Administrators-tab follow-up (2026-08-20) — owns its own Roles/Admin
  // Users sub-tab switch; see js/administrators.js.
  'administradores-section': loadAdministratorsSection,
});

// Administrators-tab follow-up (2026-08-20) — checked BEFORE the normal
// `isLoggedIn()` branch below: an invite link (`?invite=<token>`) must show
// the accept-invite view regardless of whatever session state (logged in,
// logged out, expired) happens to already exist in this browser — e.g. an
// existing admin opening a colleague's invite link in the same browser they
// themselves are logged in on. `session.js` is `localStorage`-backed
// (2026-08-11 follow-up), so a real full-page reload no longer discards a
// session either way, but this check has nothing to do with that — it's
// purely about which of the 3 top-level views this specific URL should show.
const inviteToken = new URLSearchParams(window.location.search).get('invite');
if (inviteToken) {
  initAcceptInviteView(inviteToken);
} else if (isLoggedIn()) {
  // Session restored from `localStorage` (2026-08-11 follow-up — see
  // `session.js`'s own header comment) — redraw the header identity here
  // too, the same way `login.js` does right after a fresh login, since
  // this code path never runs through that file at all on a reload.
  const { email, displayName } = getCurrentAdminIdentity();
  document.getElementById('admin-display-name').textContent = displayName ?? '';
  document.getElementById('admin-email').textContent = email ?? '';
  document.getElementById('admin-avatar').textContent = initialsFor(displayName ?? '');
  showDashboardView();
  showSection('settings-section');
} else {
  showLoginView();
}

document
  .getElementById('logout-button')
  .addEventListener('click', async () => {
    try {
      await graphqlRequest('mutation { adminLogout }');
    } finally {
      clearSession();
      showLoginView();
    }
  });
