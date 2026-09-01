// Editable transactional-email templates follow-up (2026-08-24) — makes the
// 3 fixed transactional emails (verification-code, password-reset-code,
// admin-invite) 100% editable from this panel (subject + HTML body +
// plain-text body), replacing what used to be hardcoded `.template.ts`
// string builders on the backend. `key`s are a CLOSED, fixed set (3 rows, no
// create/delete) — this is rendered as 3 cards, NOT a Tabulator grid (that
// machinery is overkill for a fixed 3-row set) and NOT a tree
// (`categories.js`'s own reason for its own custom rendering doesn't apply
// here either). Same
// `graphqlRequest`/`handleAdminUnauthenticated`/`showSuccess`/`showError`
// feedback conventions as every other section in this panel — see
// `adminUsers.js` for the closest list+edit-dialog+mutation example this
// mirrors.
//
// Marketing-tab follow-up (2026-08-25): this module and its element ids are
// UNCHANGED by that reorganization — it now renders inside the "Email"
// sub-tab of the top-level "Marketing" section (`js/marketing.js` owns that
// tablist) instead of being its own top-level nav item, but
// `loadEmailTemplates()` neither knows nor cares which section/tab wraps its
// elements.
import { graphqlRequest, GraphQLNetworkError } from './graphqlClient.js';
import { clearSession } from './session.js';
import { showLoginView } from './view.js';

const EMAIL_TEMPLATES_QUERY = `
  query EmailTemplates {
    emailTemplates {
      id
      key
      subject
      htmlBody
      textBody
      updatedBy
      updatedAt
    }
  }
`;

const UPDATE_EMAIL_TEMPLATE_MUTATION = `
  mutation UpdateEmailTemplate($key: String!, $input: UpdateEmailTemplateInput!) {
    updateEmailTemplate(key: $key, input: $input) {
      id key subject htmlBody textBody updatedBy updatedAt
    }
  }
`;

const SEND_TEST_EMAIL_TEMPLATE_MUTATION = `
  mutation SendTestEmailTemplate($key: String!, $to: String!) {
    sendTestEmailTemplate(key: $key, to: $to)
  }
`;

// Backend single source of truth is
// `src/platform-admin/email-templates/known-email-template-keys.constant.ts`
// — hardcoded again here (not shared cross-language) since these are plain
// Spanish product-facing labels/hints, not a runtime contract. Keep both in
// sync by hand if a 4th template key is ever added (unlikely — see that
// constant's own header comment on why the key set is deliberately closed).
const EMAIL_TEMPLATE_LABELS = {
  verification_code: 'Verificación de email',
  password_reset_code: 'Restablecer contraseña',
  admin_invite: 'Invitación de administrador',
};

const EMAIL_TEMPLATE_VARIABLE_HINTS = {
  verification_code: '{{greeting}}, {{firstName}}, {{code}}, {{ttlMinutes}}',
  password_reset_code: '{{greeting}}, {{firstName}}, {{code}}, {{ttlMinutes}}',
  admin_invite: '{{greeting}}, {{displayName}}, {{inviteLink}}, {{ttlHours}}',
};

const listEl = document.getElementById('email-templates-list');
const errorEl = document.getElementById('email-templates-error');
const successEl = document.getElementById('email-templates-success');

const editDialog = document.getElementById('email-template-edit-dialog');
const editHeadingEl = document.getElementById('email-template-edit-heading');
const editForm = document.getElementById('email-template-edit-form');
const editErrorEl = document.getElementById('email-template-edit-error');
const editVariablesHintEl = document.getElementById(
  'email-template-edit-variables-hint',
);
const editCloseButton = document.getElementById('email-template-edit-close');
const editCancelButton = document.getElementById('email-template-edit-cancel');
const editSubjectInput = document.getElementById('email-template-edit-subject');
const editHtmlBodyInput = document.getElementById('email-template-edit-html-body');
const editTextBodyInput = document.getElementById('email-template-edit-text-body');
const editSubmitButton = document.getElementById('email-template-edit-submit');

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = message === '';
}

function showSuccess(message) {
  successEl.textContent = message;
  successEl.hidden = message === '';
}

function showEditError(message) {
  editErrorEl.textContent = message;
  editErrorEl.hidden = message === '';
}

function handleAdminUnauthenticated(body) {
  const code = body.errors?.[0]?.extensions?.code;
  if (code === 'ADMIN_UNAUTHENTICATED') {
    clearSession();
    showLoginView();
    return true;
  }
  return false;
}

function friendlyErrorMessage(code, fallback) {
  switch (code) {
    case 'ADMIN_FORBIDDEN':
      return 'You do not have permission to manage email templates.';
    case 'UNKNOWN_EMAIL_TEMPLATE_KEY':
      return 'Unknown email template key.';
    case 'EMAIL_TEMPLATE_ROW_NOT_SEEDED':
    case 'EMAIL_TEMPLATE_NOT_CONFIGURED':
      return 'This template has not been seeded yet on this environment.';
    case 'EMAIL_DELIVERY_DISABLED':
    case 'EMAIL_DELIVERY_MISCONFIGURED':
      return 'Email delivery is currently unavailable — the test email could not be sent.';
    default:
      return fallback;
  }
}

let latestTemplates = [];
let editingKey = null;

// ---------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------

function openEditDialog(template) {
  editingKey = template.key;
  showEditError('');
  editHeadingEl.textContent = `Edit — ${EMAIL_TEMPLATE_LABELS[template.key] ?? template.key}`;
  editVariablesHintEl.textContent = `Available variables: ${
    EMAIL_TEMPLATE_VARIABLE_HINTS[template.key] ?? ''
  }`;
  editSubjectInput.value = template.subject;
  editHtmlBodyInput.value = template.htmlBody;
  editTextBodyInput.value = template.textBody;
  editDialog.showModal();
}

editCloseButton.addEventListener('click', () => editDialog.close());
editCancelButton.addEventListener('click', () => editDialog.close());

editForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitEditForm();
});

async function submitEditForm() {
  showEditError('');
  editSubmitButton.disabled = true;

  try {
    const body = await graphqlRequest(UPDATE_EMAIL_TEMPLATE_MUTATION, {
      key: editingKey,
      input: {
        subject: editSubjectInput.value,
        htmlBody: editHtmlBodyInput.value,
        textBody: editTextBodyInput.value,
      },
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        editDialog.close();
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showEditError(
        friendlyErrorMessage(code, 'Could not save this template. Please try again.'),
      );
      return;
    }

    editDialog.close();
    showSuccess('Email template updated.');
    await loadEmailTemplates();
  } catch (error) {
    showEditError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    editSubmitButton.disabled = false;
  }
}

// ---------------------------------------------------------------------
// "Send a test email" — small inline email input + button, per card.
// ---------------------------------------------------------------------

async function handleSendTest(key, inputEl, button) {
  const to = inputEl.value.trim();
  if (to === '') {
    showError('Enter an email address before sending a test.');
    return;
  }

  showError('');
  showSuccess('');
  button.disabled = true;
  inputEl.disabled = true;

  try {
    const body = await graphqlRequest(SEND_TEST_EMAIL_TEMPLATE_MUTATION, {
      key,
      to,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        friendlyErrorMessage(code, 'Could not send the test email. Please try again.'),
      );
      return;
    }

    showSuccess(`Correo de prueba enviado a ${to}.`);
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    button.disabled = false;
    inputEl.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Card rendering — plain document.createElement, no framework, mirrors
// `settings.js`'s `renderTextField`-style DOM-building conventions, applied
// here to a full card (title, meta, edit button, test-send row) instead of
// a single field.
// ---------------------------------------------------------------------

function buildCard(template) {
  const col = document.createElement('div');
  col.className = 'col-12 col-lg-6';

  const card = document.createElement('div');
  card.className = 'card';

  const cardBody = document.createElement('div');
  cardBody.className = 'card-body';

  const title = document.createElement('h3');
  title.className = 'card-title mb-1';
  title.textContent = EMAIL_TEMPLATE_LABELS[template.key] ?? template.key;
  cardBody.appendChild(title);

  const keyEl = document.createElement('div');
  keyEl.className = 'text-secondary small mb-2';
  keyEl.textContent = template.key;
  cardBody.appendChild(keyEl);

  const subjectEl = document.createElement('div');
  subjectEl.className = 'mb-2';
  const subjectLabel = document.createElement('strong');
  subjectLabel.textContent = 'Subject: ';
  subjectEl.appendChild(subjectLabel);
  subjectEl.appendChild(document.createTextNode(template.subject));
  cardBody.appendChild(subjectEl);

  const metaEl = document.createElement('div');
  metaEl.className = 'text-secondary small mb-3';
  metaEl.textContent = template.updatedBy
    ? `Last updated by ${template.updatedBy}`
    : 'Never edited since being seeded.';
  cardBody.appendChild(metaEl);

  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'btn btn-primary mb-3';
  editButton.textContent = 'Editar';
  editButton.addEventListener('click', () => openEditDialog(template));
  cardBody.appendChild(editButton);

  const testRow = document.createElement('div');
  testRow.className = 'input-group';

  const testInput = document.createElement('input');
  testInput.type = 'email';
  testInput.className = 'form-control';
  testInput.placeholder = 'test@example.com';
  testRow.appendChild(testInput);

  const testButton = document.createElement('button');
  testButton.type = 'button';
  testButton.className = 'btn btn-outline-secondary';
  testButton.textContent = 'Enviar de prueba';
  testButton.addEventListener('click', () =>
    void handleSendTest(template.key, testInput, testButton),
  );
  testRow.appendChild(testButton);

  cardBody.appendChild(testRow);
  card.appendChild(cardBody);
  col.appendChild(card);
  return col;
}

function renderCards(templates) {
  listEl.textContent = '';
  for (const template of templates) {
    listEl.appendChild(buildCard(template));
  }
}

export async function loadEmailTemplates() {
  showError('');
  showSuccess('');

  try {
    const body = await graphqlRequest(EMAIL_TEMPLATES_QUERY, {});

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) return;
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to view email templates.'
          : 'Could not load email templates.',
      );
      return;
    }

    latestTemplates = body.data.emailTemplates;
    renderCards(latestTemplates);
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  }
}
