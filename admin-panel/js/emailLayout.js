// Shared email header/footer follow-up (2026-08-25) — the ONE, always-exactly-
// one-row `EmailLayout` singleton, editable from this panel (header HTML/
// footer HTML/header plain-text/footer plain-text), applied automatically to
// every `EmailTemplate` at send-time by the backend's `EmailTemplateRenderer`
// (`src/email/templates/email-template-renderer.service.ts`) — see that
// service's own header comment for the full composition contract. Rendered
// as ONE card (this is always exactly one row, never a list/grid), NOT the
// 3-card pattern `emailTemplates.js` uses for its fixed-3-row set. Same
// `graphqlRequest`/`handleAdminUnauthenticated`/`showSuccess`/`showError`
// feedback conventions as every other section in this panel — mirrors
// `emailTemplates.js`'s own edit-dialog structure closely, just for a single
// row instead of N cards.
import { graphqlRequest, GraphQLNetworkError } from './graphqlClient.js';
import { clearSession } from './session.js';
import { showLoginView } from './view.js';

const EMAIL_LAYOUT_QUERY = `
  query EmailLayout {
    emailLayout {
      id
      headerHtml
      footerHtml
      headerText
      footerText
      logoUrl
      updatedBy
      updatedAt
    }
  }
`;

const UPDATE_EMAIL_LAYOUT_MUTATION = `
  mutation UpdateEmailLayout($input: UpdateEmailLayoutInput!) {
    updateEmailLayout(input: $input) {
      id headerHtml footerHtml headerText footerText logoUrl updatedBy updatedAt
    }
  }
`;

// Uploadable-logo follow-up (2026-08-25) — same "request a signed URL, PUT
// the raw bytes outside GraphQL, then persist the resulting public URL"
// flow GOS-38's own attachment-upload UI already established (see that
// feature's own admin/mobile counterparts), just reused for this single
// shared field. No "upload ref" concept here — the PUT's resulting
// `publicUrl` is persisted directly via `updateEmailLayout(logoUrl:)`.
const REQUEST_EMAIL_LOGO_UPLOAD_URL_MUTATION = `
  mutation RequestEmailLogoUploadUrl($input: RequestEmailLogoUploadUrlInput!) {
    requestEmailLogoUploadUrl(input: $input) {
      uploadUrl
      publicUrl
      expiresAt
    }
  }
`;

const cardEl = document.getElementById('email-layout-card');
const metaEl = document.getElementById('email-layout-meta');
const errorEl = document.getElementById('email-layout-error');
const successEl = document.getElementById('email-layout-success');
const editButton = document.getElementById('email-layout-edit-button');

// Uploadable-logo follow-up (2026-08-25) — independent from the edit
// dialog's textareas; lives directly on the card itself, as its own
// visually-separate section (see admin-panel/index.html).
const logoPreviewImg = document.getElementById('email-layout-logo-preview');
const logoEmptyEl = document.getElementById('email-layout-logo-empty');
const logoFileInput = document.getElementById('email-layout-logo-file');
const logoUploadButton = document.getElementById(
  'email-layout-logo-upload-button',
);

const editDialog = document.getElementById('email-layout-edit-dialog');
const editForm = document.getElementById('email-layout-edit-form');
const editErrorEl = document.getElementById('email-layout-edit-error');
const editCloseButton = document.getElementById('email-layout-edit-close');
const editCancelButton = document.getElementById('email-layout-edit-cancel');
const editHeaderHtmlInput = document.getElementById(
  'email-layout-edit-header-html',
);
const editFooterHtmlInput = document.getElementById(
  'email-layout-edit-footer-html',
);
const editHeaderTextInput = document.getElementById(
  'email-layout-edit-header-text',
);
const editFooterTextInput = document.getElementById(
  'email-layout-edit-footer-text',
);
const editSubmitButton = document.getElementById('email-layout-edit-submit');

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
      return 'You do not have permission to manage the email layout.';
    case 'EMAIL_LAYOUT_ROW_NOT_SEEDED':
      return 'The shared email layout has not been seeded yet on this environment.';
    case 'UNSUPPORTED_EMAIL_LOGO_CONTENT_TYPE':
      return 'Unsupported file type — only PNG, JPEG, or WEBP images are allowed.';
    default:
      return fallback;
  }
}

let latestLayout = null;

// ---------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------

function openEditDialog() {
  showEditError('');
  editHeaderHtmlInput.value = latestLayout?.headerHtml ?? '';
  editFooterHtmlInput.value = latestLayout?.footerHtml ?? '';
  editHeaderTextInput.value = latestLayout?.headerText ?? '';
  editFooterTextInput.value = latestLayout?.footerText ?? '';
  editDialog.showModal();
}

editButton.addEventListener('click', openEditDialog);
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
    const body = await graphqlRequest(UPDATE_EMAIL_LAYOUT_MUTATION, {
      input: {
        headerHtml: editHeaderHtmlInput.value,
        footerHtml: editFooterHtmlInput.value,
        headerText: editHeaderTextInput.value,
        footerText: editFooterTextInput.value,
        // Uploadable-logo follow-up (2026-08-25) — this dialog never edits
        // the logo itself (see the separate upload widget on the card
        // below), so it always resubmits the CURRENT `logoUrl` unchanged.
        // `UpdateEmailLayoutInput` is a full-state input, not a partial
        // patch — omitting this would clear the logo.
        logoUrl: latestLayout?.logoUrl ?? null,
      },
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        editDialog.close();
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showEditError(
        friendlyErrorMessage(code, 'Could not save the email layout. Please try again.'),
      );
      return;
    }

    editDialog.close();
    showSuccess('Email layout updated.');
    await loadEmailLayout();
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
// Card rendering
// ---------------------------------------------------------------------

function renderCard(layout) {
  metaEl.textContent = layout.updatedBy
    ? `Last updated by ${layout.updatedBy}`
    : 'Never edited since being seeded.';
  cardEl.hidden = false;
  renderLogoPreview(layout.logoUrl);
}

function renderLogoPreview(logoUrl) {
  if (logoUrl) {
    logoPreviewImg.src = logoUrl;
    logoPreviewImg.hidden = false;
    logoEmptyEl.hidden = true;
  } else {
    logoPreviewImg.hidden = true;
    logoPreviewImg.removeAttribute('src');
    logoEmptyEl.hidden = false;
  }
}

// ---------------------------------------------------------------------
// Logo upload (uploadable-logo follow-up, 2026-08-25) — independent from
// the edit dialog above: requests a signed upload URL, PUTs the selected
// file's raw bytes directly to it (outside GraphQL, same as GOS-38's own
// attachment-upload flow), then persists the resulting publicUrl via
// updateEmailLayout — resubmitting the header/footer fields EXACTLY as
// currently loaded (never any in-progress, unsaved edit dialog draft).
// ---------------------------------------------------------------------

logoUploadButton.addEventListener('click', () => {
  void uploadLogo();
});

async function uploadLogo() {
  showError('');
  showSuccess('');

  const file = logoFileInput.files?.[0];
  if (!file) {
    showError('Choose an image file first.');
    return;
  }

  logoUploadButton.disabled = true;
  try {
    const requestBody = await graphqlRequest(
      REQUEST_EMAIL_LOGO_UPLOAD_URL_MUTATION,
      { input: { fileName: file.name, contentType: file.type } },
    );

    if (requestBody.errors && requestBody.errors.length > 0) {
      if (handleAdminUnauthenticated(requestBody)) return;
      const code = requestBody.errors[0]?.extensions?.code;
      showError(
        friendlyErrorMessage(code, 'Could not start the logo upload. Please try again.'),
      );
      return;
    }

    const { uploadUrl, publicUrl } =
      requestBody.data.requestEmailLogoUploadUrl;

    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });
    if (!putResponse.ok) {
      showError('Could not upload the file. Please try again.');
      return;
    }

    const updateBody = await graphqlRequest(UPDATE_EMAIL_LAYOUT_MUTATION, {
      input: {
        headerHtml: latestLayout?.headerHtml ?? '',
        footerHtml: latestLayout?.footerHtml ?? '',
        headerText: latestLayout?.headerText ?? '',
        footerText: latestLayout?.footerText ?? '',
        logoUrl: publicUrl,
      },
    });

    if (updateBody.errors && updateBody.errors.length > 0) {
      if (handleAdminUnauthenticated(updateBody)) return;
      const code = updateBody.errors[0]?.extensions?.code;
      showError(
        friendlyErrorMessage(code, 'The file uploaded, but saving the logo failed. Please try again.'),
      );
      return;
    }

    logoFileInput.value = '';
    showSuccess('Logo updated.');
    await loadEmailLayout();
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    logoUploadButton.disabled = false;
  }
}

export async function loadEmailLayout() {
  showError('');
  showSuccess('');

  try {
    const body = await graphqlRequest(EMAIL_LAYOUT_QUERY, {});

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) return;
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to view the email layout.'
          : friendlyErrorMessage(code, 'Could not load the email layout.'),
      );
      return;
    }

    latestLayout = body.data.emailLayout;
    renderCard(latestLayout);
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  }
}
