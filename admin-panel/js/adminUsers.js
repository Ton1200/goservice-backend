// Administrators-tab follow-up (2026-08-20) — "Admin Users" sub-tab: a
// Tabulator grid over `AdminUser` (this internal panel's own operators, NOT
// GoService's consumer `User` table — see `js/userAccounts.js` for that,
// separate, `usuarios-section` grid), plus an "Invite admin" dialog and a
// per-row kebab menu (Edit / Resend invite / Revoke). Same
// GraphQL-request/error-handling/kebab-menu conventions as
// `userAccounts.js`.
import { TabulatorFull as Tabulator } from '../vendor/tabulator/js/tabulator_esm.min.mjs';
import { closeDropdownMenu, createMenuItem, openDropdownMenu } from './dropdownMenu.js';
import { graphqlRequest, GraphQLNetworkError } from './graphqlClient.js';
import { clearSession, getAdminUserId } from './session.js';
import { showLoginView } from './view.js';
import { fetchRoleOptions } from './adminRoles.js';

// Parity follow-up (2026-08-20, same day): this grid was missing the
// "Columns" visibility toggle every other Tabulator grid in this panel has
// (`serviceRequests.js`/`quotes.js`/`userAccounts.js`), and offered no
// inline cell editing despite `userAccounts.js` — the closest sibling grid,
// same kebab-menu convention — supporting it for its own equivalent fields.
// `displayName` and `status` are now editable inline (same
// revert-on-server-rejection behavior `userAccounts.js`'s own
// `handleCellEdited` already establishes); `roleId` stays dialog-only (the
// invite/edit dialog already fetches the role list asynchronously — Tabulator's
// list editor wants synchronous `values`, so reusing the dialog here avoids
// a second, parallel async-loading path for the exact same data).

const ADMIN_USERS_QUERY = `
  query AdminUsers($limit: Int, $offset: Int) {
    adminUsers(limit: $limit, offset: $offset) {
      totalCount
      items {
        id
        email
        displayName
        status
        role { id name }
        createdAt
      }
    }
  }
`;

const UPDATE_ADMIN_USER_MUTATION = `
  mutation UpdateAdminUser($id: ID!, $input: UpdateAdminUserInput!) {
    updateAdminUser(id: $id, input: $input) {
      id
      displayName
      status
      role { id name }
    }
  }
`;

const INVITE_ADMIN_USER_MUTATION = `
  mutation InviteAdminUser($input: InviteAdminUserInput!) {
    inviteAdminUser(input: $input) { id email displayName status role { id name } }
  }
`;

const RESEND_ADMIN_INVITE_MUTATION = `
  mutation ResendAdminInvite($adminUserId: ID!) {
    resendAdminInvite(adminUserId: $adminUserId) { success }
  }
`;

const DELETE_ADMIN_USER_MUTATION = `
  mutation DeleteAdminUser($id: ID!) {
    deleteAdminUser(id: $id) { success }
  }
`;

// Same phase-1-scope fetch limit precedent as `userAccounts.js`'s own
// `FETCH_LIMIT` — the expected admin count for this internal tool is in the
// tens, not thousands (see the backend's own
// `AdminRolesRepository`/`AdminLockoutGuardService` header comments for the
// same assumption).
const FETCH_LIMIT = 200;

const gridEl = document.getElementById('admin-users-grid');
const errorEl = document.getElementById('admin-users-error');
const successEl = document.getElementById('admin-users-success');
const inviteButton = document.getElementById('admin-users-invite-button');
const columnsButton = document.getElementById('admin-users-columns-button');

const inviteDialog = document.getElementById('admin-user-invite-dialog');
const inviteForm = document.getElementById('admin-user-invite-form');
const inviteErrorEl = document.getElementById('admin-user-invite-error');
const inviteCloseButton = document.getElementById('admin-user-invite-close');
const inviteCancelButton = document.getElementById('admin-user-invite-cancel');
const inviteEmailInput = document.getElementById('admin-user-invite-email');
const inviteDisplayNameInput = document.getElementById(
  'admin-user-invite-display-name',
);
const inviteRoleSelect = document.getElementById('admin-user-invite-role');

const editDialog = document.getElementById('admin-user-edit-dialog');
const editForm = document.getElementById('admin-user-edit-form');
const editErrorEl = document.getElementById('admin-user-edit-error');
const editCloseButton = document.getElementById('admin-user-edit-close');
const editCancelButton = document.getElementById('admin-user-edit-cancel');
const editDisplayNameInput = document.getElementById(
  'admin-user-edit-display-name',
);
const editRoleSelect = document.getElementById('admin-user-edit-role');
const editStatusSelect = document.getElementById('admin-user-edit-status');

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = message === '';
}

function showSuccess(message) {
  successEl.textContent = message;
  successEl.hidden = message === '';
}

function showInviteError(message) {
  inviteErrorEl.textContent = message;
  inviteErrorEl.hidden = message === '';
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

async function populateRoleSelect(selectEl, selectedRoleId) {
  selectEl.textContent = '';
  const roles = await fetchRoleOptions();
  for (const role of roles) {
    const option = document.createElement('option');
    option.value = role.id;
    option.textContent = role.name;
    selectEl.appendChild(option);
  }
  if (selectedRoleId) {
    selectEl.value = selectedRoleId;
  }
}

function dateFormatter(cell) {
  const value = cell.getValue();
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function menuItemLabel(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

let editingAdminUserId = null;

function openEditDialog(rowData) {
  editingAdminUserId = rowData.id;
  showEditError('');
  editDisplayNameInput.value = rowData.displayName;

  editStatusSelect.textContent = '';
  if (rowData.status === 'INVITED') {
    // An INVITED admin has no ACTIVE/REVOKED status to choose FROM yet —
    // rather than offering a status control that could only ever submit a
    // value different from the current one (there is no "INVITED" option),
    // this is shown read-only, matching `UpdateAdminUserInput`'s own
    // ADMIN_USER_INVALID_STATUS_TRANSITION rule (status can never be set
    // BACK to INVITED, and this admin isn't ACTIVE/REVOKED yet either).
    const option = document.createElement('option');
    option.value = 'INVITED';
    option.textContent = 'INVITED (pending — resend the invite instead)';
    editStatusSelect.appendChild(option);
    editStatusSelect.value = 'INVITED';
    editStatusSelect.disabled = true;
  } else {
    for (const value of ['ACTIVE', 'REVOKED']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      editStatusSelect.appendChild(option);
    }
    editStatusSelect.value = rowData.status;
    editStatusSelect.disabled = false;
  }

  void populateRoleSelect(editRoleSelect, rowData.role.id);
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
  const submitButton = document.getElementById('admin-user-edit-submit');
  submitButton.disabled = true;

  try {
    const input = {
      displayName: editDisplayNameInput.value.trim(),
      roleId: editRoleSelect.value,
    };
    if (!editStatusSelect.disabled) {
      input.status = editStatusSelect.value;
    }

    const body = await graphqlRequest(UPDATE_ADMIN_USER_MUTATION, {
      id: editingAdminUserId,
      input,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        editDialog.close();
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showEditError(
        code === 'CANNOT_REVOKE_OWN_ACCOUNT'
          ? 'You cannot revoke your own admin account.'
          : code === 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT'
            ? 'This change would leave no admin able to manage other admins — rejected.'
            : code === 'ADMIN_ROLE_NOT_FOUND'
              ? 'That role no longer exists.'
              : code === 'ADMIN_FORBIDDEN'
                ? 'You do not have permission to edit admin users.'
                : 'Could not save this admin user. Please try again.',
      );
      return;
    }

    editDialog.close();
    await loadAdminUsers();
    showSuccess('Admin user updated.');
  } catch (error) {
    showEditError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    submitButton.disabled = false;
  }
}

async function handleResendInvite(rowData, button) {
  showError('');
  showSuccess('');
  button.disabled = true;

  try {
    const body = await graphqlRequest(RESEND_ADMIN_INVITE_MUTATION, {
      adminUserId: rowData.id,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_USER_NOT_INVITED'
          ? 'This admin is no longer in INVITED status.'
          : code === 'EMAIL_DELIVERY_DISABLED' ||
              code === 'EMAIL_DELIVERY_MISCONFIGURED'
            ? 'Email delivery is currently unavailable — the invite could not be resent.'
            : code === 'ADMIN_FORBIDDEN'
              ? 'You do not have permission to resend invites.'
              : 'Could not resend the invite. Please try again.',
      );
      return;
    }

    showSuccess(
      body.data.resendAdminInvite.success
        ? `Invite resent to ${rowData.email}.`
        : `An invite was already sent to ${rowData.email} recently — please wait before resending.`,
    );
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    button.disabled = false;
  }
}

async function handleDelete(rowData, button) {
  const confirmed = window.confirm(
    `Permanently delete ${rowData.email}? This cannot be undone. Admins with any audit history cannot be deleted — revoke them instead.`,
  );
  if (!confirmed) {
    return;
  }

  showError('');
  showSuccess('');
  button.disabled = true;

  try {
    const body = await graphqlRequest(DELETE_ADMIN_USER_MUTATION, {
      id: rowData.id,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'CANNOT_DELETE_OWN_ACCOUNT'
          ? 'You cannot delete your own admin account.'
          : code === 'ADMIN_USER_HAS_AUDIT_HISTORY'
            ? 'This admin has audit history and cannot be permanently deleted — revoke their access instead.'
            : code === 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT'
              ? 'This deletion would leave no admin able to manage other admins — rejected.'
              : code === 'ADMIN_FORBIDDEN'
                ? 'You do not have permission to delete admin users.'
                : 'Could not delete this admin user. Please try again.',
      );
      return;
    }

    await loadAdminUsers();
    showSuccess(`${rowData.email} has been permanently deleted.`);
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    button.disabled = false;
  }
}

async function handleRevoke(rowData, button) {
  const confirmed = window.confirm(
    `Revoke ${rowData.email}? They will immediately lose all admin access.`,
  );
  if (!confirmed) {
    return;
  }

  showError('');
  showSuccess('');
  button.disabled = true;

  try {
    const body = await graphqlRequest(UPDATE_ADMIN_USER_MUTATION, {
      id: rowData.id,
      input: { status: 'REVOKED' },
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'CANNOT_REVOKE_OWN_ACCOUNT'
          ? 'You cannot revoke your own admin account.'
          : code === 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT'
            ? 'This change would leave no admin able to manage other admins — rejected.'
            : code === 'ADMIN_FORBIDDEN'
              ? 'You do not have permission to revoke admin users.'
              : 'Could not revoke this admin user. Please try again.',
      );
      return;
    }

    await loadAdminUsers();
    showSuccess(`${rowData.email} has been revoked.`);
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    button.disabled = false;
  }
}

function createKebabMenuButton(rowData) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gs-kebab-button';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', `Actions for ${rowData.email}`);
  button.textContent = '⋮';
  button.addEventListener('click', (event) => {
    event.stopPropagation();

    const items = [
      createMenuItem(menuItemLabel('Edit'), () => {
        closeDropdownMenu();
        openEditDialog(rowData);
      }),
    ];

    if (rowData.status === 'INVITED') {
      items.push(
        createMenuItem(
          menuItemLabel('Resend invite'),
          () => void handleResendInvite(rowData, button),
        ),
      );
    }

    if (rowData.status === 'ACTIVE' && rowData.id !== getAdminUserId()) {
      items.push(
        createMenuItem(
          menuItemLabel('Revoke'),
          () => void handleRevoke(rowData, button),
          { variant: 'danger' },
        ),
      );
    }

    // Always offered (server-side is the real gate — CANNOT_DELETE_OWN_ACCOUNT/
    // ADMIN_USER_HAS_AUDIT_HISTORY/WOULD_LOCK_OUT_ADMIN_MANAGEMENT all surface
    // as a clear error rather than being silently hidden client-side; hiding
    // it here for the common "has audit history" case would mean the option
    // just mysteriously never appears for almost every real admin, which is
    // more confusing than showing it and explaining why it failed).
    if (rowData.id !== getAdminUserId()) {
      items.push(
        createMenuItem(
          menuItemLabel('Delete'),
          () => void handleDelete(rowData, button),
          { variant: 'danger' },
        ),
      );
    }

    openDropdownMenu(button, items);
  });
  return button;
}

function actionsFormatter(cell) {
  const rowData = cell.getRow().getData();
  const wrapper = document.createElement('div');
  wrapper.className = 'd-flex justify-content-center';
  wrapper.appendChild(createKebabMenuButton(rowData));
  return wrapper;
}

/**
 * Inline cell-edit handler — `displayName`/`status` only (see this file's
 * top-of-file comment for why `roleId` stays dialog-only). Same
 * partial-patch-single-field/revert-on-server-rejection shape as
 * `userAccounts.js`'s own `handleCellEdited`.
 */
async function handleCellEdited(cell) {
  const field = cell.getColumn().getField();
  const newValue = cell.getValue();
  const oldValue = cell.getOldValue();
  if (newValue === oldValue) {
    return;
  }
  const rowData = cell.getRow().getData();

  showError('');
  showSuccess('');

  try {
    const body = await graphqlRequest(UPDATE_ADMIN_USER_MUTATION, {
      id: rowData.id,
      input: { [field]: newValue },
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        cell.restoreOldValue();
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'CANNOT_REVOKE_OWN_ACCOUNT'
          ? 'You cannot revoke your own admin account.'
          : code === 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT'
            ? 'This change would leave no admin able to manage other admins — rejected.'
            : code === 'ADMIN_FORBIDDEN'
              ? 'You do not have permission to edit admin users.'
              : 'Could not save this change. Please try again.',
      );
      cell.restoreOldValue();
      return;
    }

    showSuccess('Admin user updated.');
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
    cell.restoreOldValue();
  }
}

const COLUMNS = [
  { title: 'ID', field: 'id', visible: false, headerFilter: false },
  { title: 'Email', field: 'email', headerFilter: 'input', minWidth: 220 },
  {
    title: 'Display name',
    field: 'displayName',
    headerFilter: 'input',
    minWidth: 160,
    editor: 'input',
  },
  {
    title: 'Role',
    field: 'roleName',
    headerFilter: 'input',
    minWidth: 140,
  },
  {
    title: 'Status',
    field: 'status',
    headerFilter: 'list',
    headerFilterParams: { values: ['', 'INVITED', 'ACTIVE', 'REVOKED'] },
    headerFilterFunc: '=',
    minWidth: 120,
    editor: 'list',
    editorParams: { values: ['ACTIVE', 'REVOKED'] },
    // An INVITED admin has no ACTIVE/REVOKED status to edit FROM yet — same
    // rule the "Edit" dialog already enforces (see `openEditDialog`'s own
    // comment). Editing is also pointless (though harmless — the server
    // rejects it) for a row you can't act on anyway.
    editable: (cell) => cell.getData().status !== 'INVITED',
  },
  {
    title: 'Created At',
    field: 'createdAt',
    formatter: dateFormatter,
    headerFilter: false,
    minWidth: 120,
  },
  {
    title: 'Actions',
    formatter: actionsFormatter,
    headerFilter: false,
    headerSort: false,
    hozAlign: 'center',
    width: 70,
  },
];

let table = null;

/**
 * Builds the "Columns" toolbar button's menu content — IDENTICAL logic to
 * `serviceRequests.js`/`quotes.js`'s own `columnVisibilityMenu`. Must be
 * called with `this` bound to the Tabulator table instance.
 */
function columnVisibilityMenu() {
  const menu = [];
  for (const column of this.getColumns()) {
    const field = column.getField();
    if (!field) continue; // The formatter-only "Actions" column has no field.

    const label = document.createElement('label');
    label.className = 'd-flex align-items-center gap-2 mb-0';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'form-check-input mt-0';
    checkbox.checked = column.isVisible();

    const text = document.createElement('span');
    text.textContent = column.getDefinition().title;

    label.append(checkbox, text);

    menu.push({
      label,
      action: (event) => {
        event.stopPropagation();
        column.toggle();
        checkbox.checked = column.isVisible();
      },
    });
  }
  return menu;
}

columnsButton.addEventListener('click', () => {
  if (!table) {
    return; // Nothing to toggle yet — before the first loadAdminUsers() resolves.
  }
  const menuEntries = columnVisibilityMenu.call(table);
  const items = menuEntries.map((entry) =>
    createMenuItem(entry.label, entry.action, { keepOpen: true }),
  );
  openDropdownMenu(columnsButton, items);
});

function buildTable(initialData) {
  table = new Tabulator(gridEl, {
    columns: COLUMNS,
    data: initialData,
    layout: 'fitDataStretch',
    movableColumns: true,
    persistence: { columns: true },
    persistenceID: 'goservice-admin-users-v1',
    placeholder: 'No admin users found.',
  });
  table.on('cellEdited', (cell) => void handleCellEdited(cell));
}

// ---------------------------------------------------------------------
// "Invite admin" dialog
// ---------------------------------------------------------------------

inviteButton.addEventListener('click', () => {
  showInviteError('');
  inviteForm.reset();
  void populateRoleSelect(inviteRoleSelect, null);
  inviteDialog.showModal();
  inviteEmailInput.focus();
});

inviteCloseButton.addEventListener('click', () => inviteDialog.close());
inviteCancelButton.addEventListener('click', () => inviteDialog.close());

inviteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitInviteForm();
});

async function submitInviteForm() {
  showInviteError('');
  const submitButton = document.getElementById('admin-user-invite-submit');
  submitButton.disabled = true;

  try {
    const body = await graphqlRequest(INVITE_ADMIN_USER_MUTATION, {
      input: {
        email: inviteEmailInput.value.trim(),
        displayName: inviteDisplayNameInput.value.trim(),
        roleId: inviteRoleSelect.value,
      },
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        inviteDialog.close();
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showInviteError(
        code === 'ADMIN_USER_EMAIL_TAKEN'
          ? 'An admin user with that email already exists.'
          : code === 'ADMIN_ROLE_NOT_FOUND'
            ? 'That role no longer exists.'
            : code === 'EMAIL_DELIVERY_DISABLED' ||
                code === 'EMAIL_DELIVERY_MISCONFIGURED'
              ? 'Email delivery is currently unavailable — configure it under Settings first.'
              : code === 'ADMIN_FORBIDDEN'
                ? 'You do not have permission to invite admin users.'
                : 'Could not send the invite. Please try again.',
      );
      return;
    }

    inviteDialog.close();
    await loadAdminUsers();
    showSuccess(`Invite sent to ${body.data.inviteAdminUser.email}.`);
  } catch (error) {
    showInviteError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    submitButton.disabled = false;
  }
}

export async function loadAdminUsers() {
  showError('');
  showSuccess('');

  try {
    const body = await graphqlRequest(ADMIN_USERS_QUERY, {
      limit: FETCH_LIMIT,
      offset: 0,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      showError('Could not load admin users.');
      return;
    }

    const items = body.data.adminUsers.items.map((item) => ({
      ...item,
      roleName: item.role.name,
    }));

    if (table) {
      await table.setData(items);
    } else {
      buildTable(items);
    }
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  }
}
