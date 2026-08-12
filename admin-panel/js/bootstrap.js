// Slice-1 page bootstrap: no router, just this one document's sections
// toggled by `js/view.js` (login<->dashboard) and `js/nav.js` (sidebar
// sections within the dashboard) — see the comment above `<body>` in
// `index.html`. Since `session.js` is memory-only, `isLoggedIn()` is ALWAYS
// false right after a genuine full-page load (fresh module instance) —
// this branch shows the login view. It's the login->dashboard transition
// inside `login.js` (no longer a navigation) that keeps the session alive
// for the rest of the tab's lifetime.
//
// Extracted from an inline `<script type="module">...</script>` block that
// used to live directly in `index.html` — moved to this external,
// same-origin file so the app can ship a real Content-Security-Policy
// (`script-src 'self'`) without `'unsafe-inline'`. See
// `src/bootstrap/apply-security-middleware.ts` for the CSP configuration
// this enables.
import { isLoggedIn, clearSession } from './session.js';
import { graphqlRequest } from './graphqlClient.js';
import { loadSettings } from './settings.js';
import { loadUserAccounts } from './userAccounts.js';
import { showLoginView, showDashboardView } from './view.js';
import { initNav, showSection } from './nav.js';

initNav({
  'settings-section': loadSettings,
  // GOS-3x follow-up — same "fetch fresh data every time this section is
  // shown" pattern as Configuración above, now that Usuarios is a real,
  // backend-connected grid instead of static mock markup.
  'usuarios-section': loadUserAccounts,
});

if (isLoggedIn()) {
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
