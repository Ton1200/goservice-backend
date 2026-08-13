import { graphqlRequest, GraphQLNetworkError } from './graphqlClient.js';
import { saveSession } from './session.js';
import { showDashboardView } from './view.js';
import { showSection } from './nav.js';

const ADMIN_LOGIN_MUTATION = `
  mutation AdminLogin($input: AdminLoginInput!) {
    adminLogin(input: $input) {
      adminUserId
      sessionToken
      sessionExpiresAt
      email
      displayName
    }
  }
`;

/**
 * Up to 2 uppercase initials from a display name (e.g. "Jane Doe" -> "JD",
 * "Jane" -> "J"), for the avatar circle. Never touches innerHTML — only
 * ever assigned via textContent here and in `bootstrap.js` (which reuses
 * this same function to redraw the header on a page-reload session
 * restore, now that `session.js` is `localStorage`-backed — see that
 * file's own header comment).
 */
export function initialsFor(displayName) {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function showError(message) {
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = message;
  errorEl.hidden = message === '';
}

async function handleSubmit(event) {
  event.preventDefault();
  showError('');

  const emailInputValue = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const submitButton = document.getElementById('login-submit');
  submitButton.disabled = true;

  try {
    const body = await graphqlRequest(ADMIN_LOGIN_MUTATION, {
      input: { email: emailInputValue, password },
    });

    if (body.errors && body.errors.length > 0) {
      // adminLogin collapses every failure to one generic
      // ADMIN_AUTHENTICATION_FAILED — never reveal which case occurred.
      showError('Invalid email or password.');
      return;
    }

    // Renamed on destructure (`email` -> `loggedInEmail`) deliberately: a
    // `const email` here, in the SAME `try` block as `emailInputValue`'s
    // use above, would put `email` in its block-scoped temporal dead zone
    // for the whole block — including the `graphqlRequest(...)` call
    // above it — throwing "Cannot access 'email' before initialization"
    // on every login attempt. Confirmed live via Playwright before this
    // fix. `try { }` is one block scope, not one-scope-per-statement.
    const { adminUserId, sessionToken, email: loggedInEmail, displayName } =
      body.data.adminLogin;
    saveSession({
      sessionToken,
      adminUserId,
      email: loggedInEmail,
      displayName,
    });
    // Populated here from the mutation's own fresh response (simplest —
    // the data is already in hand). `bootstrap.js` populates the SAME
    // header elements the same way, from `session.js`'s stored identity,
    // for the page-reload-while-still-logged-in case (see that file).
    // `textContent`, not `innerHTML` — avoid any avoidable XSS surface,
    // same pattern as `settings.js`'s own rendering.
    document.getElementById('admin-display-name').textContent = displayName;
    document.getElementById('admin-email').textContent = loggedInEmail;
    document.getElementById('admin-avatar').textContent = initialsFor(displayName);
    // Section toggle, not a navigation — see `js/view.js` for why: a real
    // page load here would tear down this very module graph (including
    // `session.js`'s in-memory token we just saved) before the destination
    // ever ran.
    showDashboardView();
    // Always land on Configuración on a fresh login, regardless of which
    // sidebar section happened to be showing before a previous logout —
    // see `js/nav.js` (this also triggers its registered onShow callback,
    // i.e. loadSettings()).
    showSection('settings-section');
  } catch (error) {
    if (error instanceof GraphQLNetworkError) {
      showError(error.message);
    } else {
      showError('Something went wrong. Please try again.');
    }
  } finally {
    submitButton.disabled = false;
  }
}

document.getElementById('login-form').addEventListener('submit', handleSubmit);
