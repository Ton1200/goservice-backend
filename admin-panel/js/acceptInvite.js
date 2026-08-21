// Administrators-tab follow-up (2026-08-20) — `#accept-invite-view`: reads
// the `?invite=<token>` query param (see `js/bootstrap.js`'s own pre-check,
// which runs before the normal `isLoggedIn()` branch), submits it plus a new
// password to `acceptAdminInvite`, and on success shows a confirmation +
// link back to sign-in. `acceptAdminInvite` is the ONE unauthenticated
// mutation in this whole feature — `graphqlRequest` still attaches a stored
// bearer token if one happens to exist (harmless: this resolver has no
// guard at all and ignores it).
import { graphqlRequest, GraphQLNetworkError } from './graphqlClient.js';
import { showAcceptInviteView, showLoginView } from './view.js';

const ACCEPT_ADMIN_INVITE_MUTATION = `
  mutation AcceptAdminInvite($input: AcceptAdminInviteInput!) {
    acceptAdminInvite(input: $input) {
      success
      errors { code message }
    }
  }
`;

const formEl = document.getElementById('accept-invite-form');
const passwordInput = document.getElementById('accept-invite-password');
const errorEl = document.getElementById('accept-invite-error');
const successEl = document.getElementById('accept-invite-success');
const submitButton = document.getElementById('accept-invite-submit');
const backToLoginLink = document.getElementById('accept-invite-back-to-login');

let currentToken = null;

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = message === '';
}

function showSuccess(message) {
  successEl.textContent = message;
  successEl.hidden = message === '';
}

/** Called from `js/bootstrap.js` when the URL carries `?invite=<token>`. */
export function initAcceptInviteView(token) {
  currentToken = token;
  showError('');
  showSuccess('');
  formEl.hidden = false;
  formEl.reset();
  showAcceptInviteView();
}

formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitAcceptInvite();
});

async function submitAcceptInvite() {
  showError('');
  showSuccess('');
  submitButton.disabled = true;

  try {
    const body = await graphqlRequest(ACCEPT_ADMIN_INVITE_MUTATION, {
      input: { token: currentToken, newPassword: passwordInput.value },
    });

    if (body.errors && body.errors.length > 0) {
      showError('Something went wrong. Please try again.');
      return;
    }

    const result = body.data.acceptAdminInvite;
    if (!result.success) {
      // Every invalid case (nonexistent/expired/consumed/invalidated token)
      // collapses into the SAME generic message server-side — this UI
      // simply shows whatever it's given, never invents a more specific one.
      showError(
        result.errors?.[0]?.message ??
          'This invite link is invalid or has expired.',
      );
      return;
    }

    formEl.hidden = true;
    showSuccess(
      'Your password has been set. You can now sign in with your email and new password.',
    );
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    submitButton.disabled = false;
  }
}

backToLoginLink.addEventListener('click', (event) => {
  event.preventDefault();
  showLoginView();
});
