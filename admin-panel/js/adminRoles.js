// Administrators-tab follow-up (2026-08-20) — "Roles" sub-tab: lists every
// `AdminRole` (the 3 seeded system roles + any admin-created ones) with its
// full permission set, and a shared create/edit `<dialog>` with a
// checkbox-matrix over every `Permission` value. Same GraphQL-request/
// error-handling conventions as `settings.js`/`userAccounts.js`/
// `categories.js` (`graphqlRequest`, `handleAdminUnauthenticated`,
// `showError`), and the same "shared create/edit dialog, decided by
// in-memory `editingId` state" pattern `categories.js` already establishes.
//
// Grid-parity follow-up (2026-08-20, same day): this list originally
// rendered as a plain hand-built `<table>` (no filtering, no column
// visibility toggle) — inconsistent with every other data-bearing section in
// this panel, which are all real Tabulator grids. Converted to a Tabulator
// grid with the same header-filter/"Columns"-toggle conventions
// `serviceRequests.js`/`quotes.js`/`adminUsers.js` already establish. Still
// no inline cell editing here (unlike `adminUsers.js`'s `displayName`/
// `status`) — a role's only editable field, its permission set, is a
// checkbox matrix that genuinely needs the dialog's real estate, not a
// single Tabulator cell.
import { TabulatorFull as Tabulator } from '../vendor/tabulator/js/tabulator_esm.min.mjs';
import { createMenuItem, openDropdownMenu } from './dropdownMenu.js';
import { graphqlRequest, GraphQLNetworkError } from './graphqlClient.js';
import { clearSession } from './session.js';
import { showLoginView } from './view.js';

const ADMIN_ROLES_QUERY = `
  query AdminRoles {
    adminRoles { id name permissions }
  }
`;

const CREATE_ADMIN_ROLE_MUTATION = `
  mutation CreateAdminRole($input: CreateAdminRoleInput!) {
    createAdminRole(input: $input) { id name permissions }
  }
`;

const UPDATE_ADMIN_ROLE_PERMISSIONS_MUTATION = `
  mutation UpdateAdminRolePermissions($id: ID!, $permissions: [Permission!]!) {
    updateAdminRolePermissions(id: $id, permissions: $permissions) { id name permissions }
  }
`;

const DELETE_ADMIN_ROLE_MUTATION = `
  mutation DeleteAdminRole($id: ID!) {
    deleteAdminRole(id: $id) { success }
  }
`;

// Grid-parity/UX follow-up (2026-08-20, same day) — replaces a flat list of
// 15 raw `Permission` enum strings (e.g. reading "FEATURE_FLAGS_WRITE" as a
// checkbox label) with a resource × action MATRIX: one row per resource,
// one column per action (Read/Write/Delete/Manage), a checkbox only where
// that specific combination is a REAL `Permission` value. Directly mirrors
// `prisma/schema.prisma`'s own enum ordering/grouping (every value is
// already named `<RESOURCE>_<ACTION>`, one `ADMIN_USERS_MANAGE` exception)
// — this is a presentation-layer regrouping of the exact same 15 values,
// not a new permission model; `readCheckedPermissions()` below still just
// collects whichever checkboxes end up checked, regardless of table
// structure. Hardcoded here deliberately, same trade-off
// `userAccounts.js`'s `ACCOUNT_STATUS_VALUES` already accepts: no build
// step/codegen, and introspection is disabled by default in every real
// environment. Keep in sync by hand if the backend enum ever changes.
const PERMISSION_GROUPS = [
  {
    label: 'Feature Flags',
    read: 'FEATURE_FLAGS_READ',
    write: 'FEATURE_FLAGS_WRITE',
  },
  {
    label: 'Credentials',
    read: 'CREDENTIALS_READ',
    write: 'CREDENTIALS_WRITE',
  },
  // The one resource with no Read/Write split — a single, all-or-nothing
  // capability (see this feature's own ADR — deliberately not split into
  // ADMIN_USERS_READ/WRITE, the whole "Administrators" tab is one
  // all-or-nothing gate).
  { label: 'Admin Users', manage: 'ADMIN_USERS_MANAGE' },
  { label: 'Sessions', read: 'SESSIONS_READ' },
  { label: 'Audit Log', read: 'AUDIT_LOG_READ' },
  {
    label: 'User Accounts',
    read: 'USER_ACCOUNTS_READ',
    write: 'USER_ACCOUNTS_WRITE',
    delete: 'USER_ACCOUNTS_DELETE',
  },
  {
    label: 'Service Requests',
    read: 'SERVICE_REQUESTS_READ',
    write: 'SERVICE_REQUESTS_WRITE',
  },
  {
    label: 'Categories',
    read: 'CATEGORIES_READ',
    write: 'CATEGORIES_WRITE',
  },
  { label: 'Quotes', read: 'QUOTES_READ' },
  // GOS-53 (2026-08-21) — added here 2026-08-21 follow-up: this row was
  // missing from the very start (the resource × action matrix above wasn't
  // updated when `QUOTE_NEGOTIATION_READ` was added to the `Permission`
  // enum), which meant no admin could ever be granted this permission
  // through the panel at all. Same fix pattern as `Engagement Chat` below.
  { label: 'Quote Negotiation', read: 'QUOTE_NEGOTIATION_READ' },
  // GOS-46 (2026-08-21) — same "row missing from the matrix" gap as
  // `Quote Negotiation` above: `ENGAGEMENT_CHAT_READ` existed on the
  // `Permission` enum with no way to grant/revoke it from this panel.
  { label: 'Engagement Chat', read: 'ENGAGEMENT_CHAT_READ' },
  // GOS-59 (2026-08-24) — same "row missing from the matrix" gap as
  // `Quote Negotiation`/`Engagement Chat` above: `APPOINTMENTS_READ` existed
  // on the `Permission` enum (gates `adminAppointmentsByEngagement`) with no
  // way to grant/revoke it from this panel. Human-reported: a real
  // already-bootstrapped SUPER_ADMIN saw "You don't have permission to view
  // this engagement's appointments." with no checkbox anywhere to fix it —
  // `bootstrap-super-admin.ts`'s `seedRoles()` deliberately never resets an
  // EXISTING role's permissions (see that script's own header comment), so
  // this panel's Roles screen is the only recovery path on a machine that
  // was already bootstrapped before this permission existed.
  { label: 'Appointments', read: 'APPOINTMENTS_READ' },
  // Editable transactional-email templates follow-up (2026-08-24) — same
  // "row missing from the matrix" gap as every entry above it: this repo's
  // own bootstrap script (`scripts/bootstrap-super-admin.ts`) deliberately
  // never resets an EXISTING role's permissions once seeded (see that
  // file's "PERMISSIONS GUARANTEE — NARROWED" comment), so on any
  // already-bootstrapped environment this Roles screen is the ONLY way to
  // grant EMAIL_TEMPLATES_READ/WRITE to a role — without this row there was
  // no checkbox anywhere to do that, which is exactly the failure a real
  // admin hit ("You do not have permission to view email templates" with no
  // way to fix it from the panel).
  {
    label: 'Email Templates',
    read: 'EMAIL_TEMPLATES_READ',
    write: 'EMAIL_TEMPLATES_WRITE',
  },
];

const ACTION_COLUMNS = [
  { key: 'read', label: 'Read' },
  { key: 'write', label: 'Write' },
  { key: 'delete', label: 'Delete' },
  { key: 'manage', label: 'Manage' },
];

// The 3 fixed, seeded role names — mirrors the backend's own
// `SEEDED_ADMIN_ROLE_NAMES` (`src/platform-admin/admin-rbac/`). Used here
// ONLY to lock the `name` field in the edit dialog (a rename attempt would
// be rejected server-side anyway, but blocking it client-side gives a
// clearer signal than a round-trip error) — permissions on these 3 roles
// remain fully editable, deliberately, per this feature's own confirmed
// design.
const SEEDED_ROLE_NAMES = ['SUPER_ADMIN', 'CONFIG_MANAGER', 'SUPPORT_VIEWER'];

const errorEl = document.getElementById('admin-roles-error');
const successEl = document.getElementById('admin-roles-success');
const gridEl = document.getElementById('admin-roles-grid');
const createButton = document.getElementById('admin-roles-create-button');
const columnsButton = document.getElementById('admin-roles-columns-button');

const formDialog = document.getElementById('admin-role-form-dialog');
const formHeading = document.getElementById('admin-role-form-heading');
const formEl = document.getElementById('admin-role-form');
const formErrorEl = document.getElementById('admin-role-form-error');
const formCloseButton = document.getElementById('admin-role-form-close');
const formCancelButton = document.getElementById('admin-role-form-cancel');
const nameInput = document.getElementById('admin-role-form-name');
const nameHintEl = document.getElementById('admin-role-form-name-hint');
const permissionsContainer = document.getElementById(
  'admin-role-form-permissions',
);

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = message === '';
}

function showSuccess(message) {
  successEl.textContent = message;
  successEl.hidden = message === '';
}

function showFormError(message) {
  formErrorEl.textContent = message;
  formErrorEl.hidden = message === '';
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

// In-memory cache of the last successful `adminRoles` read — reused by
// `js/adminUsers.js` (via `getCachedRoles`/`fetchRoleOptions`) to populate
// its own role `<select>` dropdowns without a second, duplicate query
// definition living in two files.
let cachedRoles = [];

let editingRoleId = null; // null while creating a NEW role.

/**
 * Renders the resource × action permission matrix (see `PERMISSION_GROUPS`/
 * `ACTION_COLUMNS`' own header comment) as a real `<table>` — one row per
 * resource, one column per action, a checkbox only where that resource
 * actually has a `Permission` value for that action (an em dash otherwise,
 * matching a plain empty grid cell rather than a disabled/greyed-out
 * checkbox, which would visually suggest "not permitted right now" instead
 * of "this combination doesn't exist"). Each row also gets a "select all
 * (row)" checkbox — cheap given how few columns any one row actually has,
 * and it's the one convenience the reference screenshot's own "All" column
 * offered that's worth keeping.
 */
function buildPermissionCheckboxes(checkedPermissions) {
  permissionsContainer.textContent = '';
  const checkedSet = new Set(checkedPermissions);

  const table = document.createElement('table');
  table.className = 'table table-vcenter gs-permission-matrix';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const resourceHeader = document.createElement('th');
  resourceHeader.textContent = 'Resource';
  headRow.appendChild(resourceHeader);
  const allHeader = document.createElement('th');
  allHeader.className = 'text-center';
  allHeader.textContent = 'All';
  headRow.appendChild(allHeader);
  for (const column of ACTION_COLUMNS) {
    const th = document.createElement('th');
    th.className = 'text-center';
    th.textContent = column.label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  for (const group of PERMISSION_GROUPS) {
    const row = document.createElement('tr');

    const labelCell = document.createElement('td');
    labelCell.textContent = group.label;
    row.appendChild(labelCell);

    // Built as each action cell is added below, so the row's own "All"
    // checkbox can wire up listeners against them.
    const rowCheckboxes = [];

    const allCell = document.createElement('td');
    allCell.className = 'text-center';
    const allCheckbox = document.createElement('input');
    allCheckbox.type = 'checkbox';
    allCheckbox.className = 'form-check-input';
    allCheckbox.setAttribute('aria-label', `All ${group.label} permissions`);
    allCell.appendChild(allCheckbox);
    row.appendChild(allCell);

    for (const column of ACTION_COLUMNS) {
      const cell = document.createElement('td');
      cell.className = 'text-center';
      const permission = group[column.key];

      if (permission) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        // `gs-permission-value-checkbox` (not just `form-check-input`,
        // which the row's own "All" checkbox also carries) — lets
        // `readCheckedPermissions()` below select ONLY real
        // permission-value checkboxes, never the "All" convenience toggle
        // (which has no `value` and would otherwise submit as the
        // browser's checkbox default, the literal string "on").
        checkbox.className = 'form-check-input gs-permission-value-checkbox';
        checkbox.value = permission;
        checkbox.checked = checkedSet.has(permission);
        checkbox.setAttribute(
          'aria-label',
          `${group.label} — ${column.label}`,
        );
        checkbox.addEventListener('change', () => {
          allCheckbox.checked = rowCheckboxes.every((cb) => cb.checked);
        });
        rowCheckboxes.push(checkbox);
        cell.appendChild(checkbox);
      } else {
        // No such Permission exists for this resource/action combination —
        // a plain dash, not a disabled checkbox (that would read as "not
        // permitted right now" rather than "not a real option").
        cell.textContent = '—';
        cell.className += ' text-secondary';
      }

      row.appendChild(cell);
    }

    allCheckbox.checked =
      rowCheckboxes.length > 0 && rowCheckboxes.every((cb) => cb.checked);
    allCheckbox.addEventListener('change', () => {
      for (const checkbox of rowCheckboxes) {
        checkbox.checked = allCheckbox.checked;
      }
    });

    tbody.appendChild(row);
  }

  table.appendChild(tbody);

  const wrapper = document.createElement('div');
  wrapper.className = 'table-responsive';
  wrapper.appendChild(table);
  permissionsContainer.appendChild(wrapper);
}

function readCheckedPermissions() {
  return Array.from(
    permissionsContainer.querySelectorAll(
      'input.gs-permission-value-checkbox:checked',
    ),
  ).map((el) => el.value);
}

function openCreateDialog() {
  editingRoleId = null;
  formHeading.textContent = 'Create role';
  showFormError('');
  formEl.reset();
  nameInput.disabled = false;
  nameHintEl.hidden = true;
  buildPermissionCheckboxes([]);
  formDialog.showModal();
  nameInput.focus();
}

function openEditDialog(role) {
  editingRoleId = role.id;
  formHeading.textContent = `Edit role — ${role.name}`;
  showFormError('');
  nameInput.value = role.name;
  // Every existing role's name is locked here (not just the 3 seeded
  // ones) — this feature has NO rename mutation at all, for ANY role,
  // seeded or custom (see backend's own `AdminRolesResolver` — deliberately
  // left as a possible future extension, not built in this scope).
  nameInput.disabled = true;
  nameHintEl.hidden = !SEEDED_ROLE_NAMES.includes(role.name);
  buildPermissionCheckboxes(role.permissions);
  formDialog.showModal();
}

createButton.addEventListener('click', () => {
  openCreateDialog();
});

formCloseButton.addEventListener('click', () => formDialog.close());
formCancelButton.addEventListener('click', () => formDialog.close());

formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitForm();
});

async function submitForm() {
  showFormError('');
  const submitButton = document.getElementById('admin-role-form-submit');
  submitButton.disabled = true;

  try {
    const permissions = readCheckedPermissions();

    if (editingRoleId === null) {
      const name = nameInput.value.trim();
      const body = await graphqlRequest(CREATE_ADMIN_ROLE_MUTATION, {
        input: { name, permissions },
      });
      if (body.errors && body.errors.length > 0) {
        if (handleAdminUnauthenticated(body)) {
          formDialog.close();
          return;
        }
        const code = body.errors[0]?.extensions?.code;
        showFormError(
          code === 'ADMIN_ROLE_NAME_TAKEN'
            ? 'A role with that name already exists.'
            : code === 'ADMIN_FORBIDDEN'
              ? 'You do not have permission to create roles.'
              : 'Could not create the role. Please try again.',
        );
        return;
      }
      formDialog.close();
      showSuccess(`Role "${body.data.createAdminRole.name}" created.`);
    } else {
      const body = await graphqlRequest(UPDATE_ADMIN_ROLE_PERMISSIONS_MUTATION, {
        id: editingRoleId,
        permissions,
      });
      if (body.errors && body.errors.length > 0) {
        if (handleAdminUnauthenticated(body)) {
          formDialog.close();
          return;
        }
        const code = body.errors[0]?.extensions?.code;
        showFormError(
          code === 'WOULD_LOCK_OUT_ADMIN_MANAGEMENT'
            ? 'This change would leave no admin able to manage other admins — rejected.'
            : code === 'ADMIN_FORBIDDEN'
              ? 'You do not have permission to edit roles.'
              : 'Could not save the role. Please try again.',
        );
        return;
      }
      formDialog.close();
      showSuccess(`Role "${body.data.updateAdminRolePermissions.name}" updated.`);
    }

    await loadAdminRoles();
  } catch (error) {
    showFormError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    submitButton.disabled = false;
  }
}

async function handleDelete(role, button) {
  const confirmed = window.confirm(
    `Delete role "${role.name}"? This cannot be undone.`,
  );
  if (!confirmed) {
    return;
  }

  showError('');
  showSuccess('');
  button.disabled = true;

  try {
    const body = await graphqlRequest(DELETE_ADMIN_ROLE_MUTATION, {
      id: role.id,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_ROLE_IS_SYSTEM_ROLE'
          ? 'This is one of the 3 seeded system roles and cannot be deleted.'
          : code === 'ADMIN_ROLE_IN_USE'
            ? 'This role is still assigned to at least one admin user and cannot be deleted.'
            : code === 'ADMIN_FORBIDDEN'
              ? 'You do not have permission to delete roles.'
              : 'Could not delete this role. Please try again.',
      );
      return;
    }

    await loadAdminRoles();
    showSuccess(`Role "${role.name}" deleted.`);
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

/**
 * Groups a role's raw `Permission` values by RESOURCE, using the exact same
 * `PERMISSION_GROUPS`/`ACTION_COLUMNS` structure the edit dialog's own
 * matrix already builds from — so the grid row and the dialog always agree
 * on how a permission set is described, never two independently-maintained
 * humanizations drifting apart. Produces e.g. "Feature Flags (Read,
 * Write) · User Accounts (Read, Write, Delete)" instead of the raw
 * "FEATURE_FLAGS_READ, FEATURE_FLAGS_WRITE, USER_ACCOUNTS_READ, ...".
 */
function formatPermissionsGrouped(permissions) {
  if (permissions.length === 0) {
    return '(none)';
  }
  const granted = new Set(permissions);
  const parts = [];
  for (const group of PERMISSION_GROUPS) {
    const actions = ACTION_COLUMNS.filter(
      (column) => group[column.key] && granted.has(group[column.key]),
    ).map((column) => column.label);
    if (actions.length > 0) {
      parts.push(`${group.label} (${actions.join(', ')})`);
    }
  }
  return parts.join(' · ');
}

function permissionsFormatter(cell) {
  return formatPermissionsGrouped(cell.getRow().getData().permissions);
}

function menuItemLabel(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function createKebabMenuButton(role) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gs-kebab-button';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', `Actions for ${role.name}`);
  button.textContent = '⋮';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const items = [
      createMenuItem(menuItemLabel('Edit'), () => openEditDialog(role)),
      createMenuItem(
        menuItemLabel('Delete'),
        () => void handleDelete(role, button),
        { variant: 'danger' },
      ),
    ];
    openDropdownMenu(button, items);
  });
  return button;
}

function actionsFormatter(cell) {
  const role = cell.getRow().getData();
  const wrapper = document.createElement('div');
  wrapper.className = 'd-flex justify-content-center';
  wrapper.appendChild(createKebabMenuButton(role));
  return wrapper;
}

const COLUMNS = [
  { title: 'ID', field: 'id', visible: false, headerFilter: false },
  { title: 'Name', field: 'name', headerFilter: 'input', minWidth: 180 },
  {
    title: 'Permission count',
    field: 'permissionCount',
    hozAlign: 'center',
    headerFilter: false,
    minWidth: 130,
  },
  {
    title: 'Permissions',
    field: 'permissions',
    formatter: permissionsFormatter,
    headerFilter: 'input',
    headerFilterFunc: (filterValue, _rowValue, rowData) =>
      rowData.permissions.some((permission) =>
        permission.toLowerCase().includes(filterValue.toLowerCase()),
      ),
    // Standing long-text-column convention (see `css/tabulator-theme.css`'s
    // own `.gs-truncate-cell` comment) — `gs-truncate-cell`
    // single-line-ellipsis-truncates whatever doesn't fit the column's own
    // width, and the `tooltip` function below reveals the FULL grouped
    // text (never just the raw truncated string) on hover/focus, plus the
    // existing click-to-edit hint. Deliberately NO `maxWidth` here — this
    // codebase's own convention is `minWidth` only on every other column in
    // every grid; a hard `maxWidth` was tried and found to fight
    // Tabulator's own drag-to-resize (the column kept snapping back to the
    // cap, unlike every other column, which the user correctly flagged as
    // inconsistent). Now grouped by resource (via `permissionsFormatter`),
    // this column's typical content is short enough that unbounded initial
    // growth is rarely an issue in practice; truncation/tooltip remain the
    // safety net for a role holding many permissions at once.
    minWidth: 200,
    cssClass: 'gs-truncate-cell',
    headerTooltip: 'Click a row’s Permissions cell to edit it directly.',
    // A plain " — " separator, not "\n" — Tabulator's built-in tooltip
    // renders this as plain text, and a raw newline isn't guaranteed to
    // render as a visual line break without extra tooltip CSS this panel
    // doesn't have.
    tooltip: (event, cell) =>
      `${formatPermissionsGrouped(cell.getRow().getData().permissions)} — click to edit`,
    // Same-day UX follow-up: clicking this cell directly opens the edit
    // dialog — previously an admin had to scroll all the way to the
    // far-right "Actions" column and open its kebab menu, tedious once a
    // role holds many permissions and that column has scrolled out of
    // view. `css/tabulator-theme.css` gives the cell a pointer cursor +
    // hover affordance so it visually reads as clickable, same as any
    // other actionable cell in this panel.
    cellClick: (event, cell) => openEditDialog(cell.getRow().getData()),
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
 * `adminUsers.js`'s/`serviceRequests.js`'s own `columnVisibilityMenu`.
 */
function columnVisibilityMenu() {
  const menu = [];
  for (const column of this.getColumns()) {
    const field = column.getField();
    if (!field) continue;

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
    return; // Nothing to toggle yet — before the first loadAdminRoles() resolves.
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
    persistenceID: 'goservice-admin-roles-v1',
    placeholder: 'No roles found.',
  });
}

export async function loadAdminRoles() {
  showError('');

  try {
    const body = await graphqlRequest(ADMIN_ROLES_QUERY);

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      showError('Could not load roles.');
      return;
    }

    cachedRoles = body.data.adminRoles;
    const items = cachedRoles.map((role) => ({
      ...role,
      permissionCount: role.permissions.length,
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

/**
 * Returns `{ id, name }` for every role currently cached from the last
 * successful `loadAdminRoles()` — used by `js/adminUsers.js` to populate its
 * own role `<select>` dropdowns (invite/edit dialogs). Fetches fresh via
 * `loadAdminRoles()` first if nothing has been loaded yet (e.g. an admin
 * opens the "Admin Users" sub-tab first, before ever visiting "Roles").
 */
export async function fetchRoleOptions() {
  if (cachedRoles.length === 0) {
    await loadAdminRoles();
  }
  return cachedRoles.map((role) => ({ id: role.id, name: role.name }));
}
