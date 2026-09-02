// GOS-3x follow-up (2026-08-10) — "Users" section: a real, functional data
// grid over GoService's own consumer `User` table (`userAccounts`/
// `updateUserAccount`/`forceUserAccountPasswordReset`, `/admin/graphql`
// only), replacing the former hardcoded-mock `<table>`. Same
// GraphQL-request/error-handling conventions as `settings.js`
// (`graphqlRequest`, `handleAdminUnauthenticated`, `showError`).
//
// Grid library: Tabulator (vendored — see
// `vendor/tabulator/NOTICE.md`), loaded here as an ES module
// (`TabulatorFull`, the build bundling every module this grid uses:
// filtering, editing, movable columns, persistence — no longer
// `headerMenu`, see the "Columns" button note below).
//
// Hard-delete follow-up (2026-08-11) — REPLACES the prior round's
// reversible deactivate/reactivate UI (a "Show deactivated" toggle, a
// muted row style + "Deactivated" badge, mutually-exclusive
// Deactivate/Reactivate row buttons) entirely, at explicit human
// authorization — see ADR 0005's Tenth round: `deleteUserAccount`/
// `bulkDeleteUserAccounts` (gated by `USER_ACCOUNTS_DELETE`) PERMANENTLY
// erase a user account and everything it owns. Row selection + a
// bulk-delete toolbar button and the itemized confirmation `<dialog>`
// (name + email per affected user, never just a count) are kept — same
// human safety requirement as before, now with copy making the
// irreversibility explicit.
//
// "View" row action + "Columns" toolbar button + per-row "⋮" kebab menu
// (GOS-3x follow-up, 2026-08-11) — three related UI changes, same round:
//   1. The column show/hide toggle (`columnVisibilityHeaderMenu` below,
//      content UNCHANGED) moves from a hidden-inside-a-per-column-menu
//      mechanism (Tabulator's own `headerMenu`, previously only on
//      "Created At") to a single, always-visible "Columns" toolbar
//      button — one discoverable place instead of two. Opened via
//      `js/dropdownMenu.js`'s own small, generic popup helper, not
//      Tabulator's `headerMenu` (which has no public API for opening its
//      popup from an arbitrary external trigger).
//   2. The "Actions" column's two loose buttons ("Force password reset",
//      "Delete") are replaced by one per-row "⋮" kebab button opening a
//      3-item menu (View/Force password reset/Delete) — the SAME
//      `js/dropdownMenu.js` popup helper as (1), reused for a second,
//      per-row case.
//   3. "View" opens a new, real `<dialog>` (`#usuarios-detail-dialog`)
//      showing the full `userAccountDetail(id)` read — a tabbed
//      Account/Customer profile/Professional profile/Activity view,
//      fetched lazily on open, never pre-loaded alongside the grid.
import { TabulatorFull as Tabulator } from '../vendor/tabulator/js/tabulator_esm.min.mjs';
import { closeDropdownMenu, createMenuItem, openDropdownMenu } from './dropdownMenu.js';
import { buildField, buildSubsection, renderDetailTabs } from './detailView.js';
import { graphqlRequest, GraphQLNetworkError } from './graphqlClient.js';
import { clearSession } from './session.js';
import { showLoginView } from './view.js';

const USER_ACCOUNTS_QUERY = `
  query UserAccounts($limit: Int, $offset: Int) {
    userAccounts(limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items {
        id
        firstName
        lastName
        email
        phoneCountryCode
        phoneNumber
        accountStatus
        authProvider
        createdAt
        hasCustomerProfile
        hasProfessionalProfile
      }
    }
  }
`;

const UPDATE_USER_ACCOUNT_MUTATION = `
  mutation UpdateUserAccount($id: ID!, $input: UpdateUserAccountInput!) {
    updateUserAccount(id: $id, input: $input) {
      id
      accountStatus
    }
  }
`;

const FORCE_RESET_MUTATION = `
  mutation ForceUserAccountPasswordReset($userId: ID!) {
    forceUserAccountPasswordReset(userId: $userId) {
      success
    }
  }
`;

const DELETE_MUTATION = `
  mutation DeleteUserAccount($id: ID!) {
    deleteUserAccount(id: $id) {
      success
    }
  }
`;

const BULK_DELETE_MUTATION = `
  mutation BulkDeleteUserAccounts($ids: [ID!]!) {
    bulkDeleteUserAccounts(ids: $ids) {
      succeededIds
      failed { id reason }
    }
  }
`;

// "View" row action (GOS-3x follow-up, 2026-08-11) — fetched lazily, on
// demand, when the detail modal opens; never pre-loaded alongside the
// grid's own lightweight `USER_ACCOUNTS_QUERY` above.
const USER_ACCOUNT_DETAIL_QUERY = `
  query UserAccountDetail($id: ID!) {
    userAccountDetail(id: $id) {
      id
      firstName
      lastName
      email
      phoneCountryCode
      phoneNumber
      accountStatus
      authProvider
      createdAt
      updatedAt
      hasCustomerProfile
      hasProfessionalProfile
      customerProfile {
        firstName
        lastName
        addressLine
        city
        province
        country
        photoUrl
        locationSharingEnabled
      }
      professionalProfile {
        firstName
        lastName
        displayName
        bio
        city
        country
        serviceAreaDescription
        photoUrl
        languages
        verificationStatus
        locationSharingEnabled
        specializations {
          role
          description
          yearsOfExperience
          order
          category {
            name
          }
        }
      }
    }
  }
`;

// Phase-1 scope: fetch one bounded page (the server-enforced max, see
// `ListUserAccountsService`) and let Tabulator's own header filters do
// client-side filtering/sorting on it — no server-side filter arguments
// exist yet. Documented explicitly, not a silent limitation — see
// `userAccounts`'s own GraphQL description and this repo's final report.
const FETCH_LIMIT = 200;

// Mirrors `UserAccountStatus` (prisma/schema.prisma). Hardcoded here
// deliberately: this admin panel has no build step/codegen and GraphQL
// introspection is disabled by default in every real environment (see
// `src/config/configuration.ts`'s `graphqlIntrospectionEnabled`), so there
// is no live source to derive this list from at runtime. Keep in sync by
// hand if the backend enum ever changes — same trade-off `settings.js`'s
// `KNOWN_SETTING_SLOTS` already accepts for a different hardcoded list.
const ACCOUNT_STATUS_VALUES = [
  'PENDING_EMAIL_VERIFICATION',
  'EMAIL_VERIFIED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
];

const gridEl = document.getElementById('usuarios-grid');
const errorEl = document.getElementById('usuarios-error');
const successEl = document.getElementById('usuarios-success');
const bulkFeedbackEl = document.getElementById('usuarios-bulk-feedback');
const bulkDeleteButton = document.getElementById(
  'usuarios-bulk-delete-button',
);
const bulkConfirmDialog = document.getElementById(
  'usuarios-bulk-confirm-dialog',
);
const bulkConfirmListEl = document.getElementById('usuarios-bulk-confirm-list');
const bulkConfirmCancelButton = document.getElementById(
  'usuarios-bulk-confirm-cancel',
);
const bulkConfirmSubmitButton = document.getElementById(
  'usuarios-bulk-confirm-submit',
);
const columnsButton = document.getElementById('usuarios-columns-button');
const detailDialog = document.getElementById('usuarios-detail-dialog');
const detailCloseButton = document.getElementById('usuarios-detail-close');
const detailErrorEl = document.getElementById('usuarios-detail-error');
const detailLoadingEl = document.getElementById('usuarios-detail-loading');
const detailContentEl = document.getElementById('usuarios-detail-content');

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = message === '';
}

function showSuccess(message) {
  successEl.textContent = message;
  successEl.hidden = message === '';
}

function clearBulkFeedback() {
  bulkFeedbackEl.textContent = '';
  bulkFeedbackEl.hidden = true;
}

/**
 * Renders PER-ROW success/failure feedback for `bulkDeleteUserAccounts` —
 * one line per user actually included in the call, explicitly NOT a single
 * generic success/error banner for the whole batch (the human's own
 * explicit requirement for this path).
 */
function renderBulkFeedback(selectedRows, succeededIds, failed) {
  bulkFeedbackEl.textContent = '';

  const list = document.createElement('ul');
  list.className = 'gs-bulk-feedback-list mb-0';

  for (const row of selectedRows) {
    const li = document.createElement('li');
    const failure = failed.find((f) => f.id === row.id);
    if (failure) {
      li.className = 'gs-bulk-feedback-item gs-bulk-feedback-item-failed';
      li.textContent = `${row.email}: failed — ${failure.reason}`;
    } else if (succeededIds.includes(row.id)) {
      li.className = 'gs-bulk-feedback-item gs-bulk-feedback-item-success';
      li.textContent = `${row.email}: deleted.`;
    } else {
      // Should never happen — succeededIds/failed together account for
      // every input id exactly once — kept as a defensive fallback only.
      li.className = 'gs-bulk-feedback-item';
      li.textContent = `${row.email}: unknown outcome.`;
    }
    list.appendChild(li);
  }

  bulkFeedbackEl.appendChild(list);
  bulkFeedbackEl.hidden = false;
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

/**
 * Client-side-only derived display value — NOT a backend field (the
 * explicit product decision this round: `hasCustomerProfile`/
 * `hasProfessionalProfile` are the only signal the backend exposes; "Type"
 * is computed from those two booleans here, never a new GraphQL field).
 */
function deriveType(row) {
  if (row.hasCustomerProfile && row.hasProfessionalProfile) return 'Both';
  if (row.hasCustomerProfile) return 'Customer';
  if (row.hasProfessionalProfile) return 'Professional';
  return 'None yet';
}

/**
 * Builds the column-visibility menu's items — content UNCHANGED from
 * before the 2026-08-11 "Columns" toolbar-button round, only HOW it's
 * opened changed (see this file's own header comment). Built with plain
 * `document.createElement`/real `<input type="checkbox">` elements (never
 * `innerHTML`, matching every other DOM-building function in this panel —
 * see `settings.js`) rather than an icon-font-based toggle, since this
 * codebase has no icon font vendored anywhere (only inline SVGs) — a
 * native checkbox is both simpler and more accessible.
 *
 * Must be called with `this` bound to the Tabulator table instance (e.g.
 * `columnVisibilityHeaderMenu.call(table)`) — `this.getColumns()` below
 * relies on it, the same calling convention Tabulator's own `headerMenu`
 * builder callback used to provide automatically before this moved to a
 * manually-triggered toolbar button.
 *
 * Returns an array of `{ label, action }` entries — `label` is the built
 * `<label>` element (checkbox + column title), `action` toggles that
 * column's visibility and keeps the menu open (via
 * `js/dropdownMenu.js`'s own `keepOpen` option at the call site below) so
 * an admin can toggle several columns in a row without re-opening the
 * menu each time.
 */
function columnVisibilityHeaderMenu() {
  const menu = [];
  for (const column of this.getColumns()) {
    const field = column.getField();
    if (!field) continue; // The formatter-only "Actions"/selection columns have no field.

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
        // Keep the menu open so an admin can toggle several columns in a
        // row without re-opening it each time.
        event.stopPropagation();
        column.toggle();
        checkbox.checked = column.isVisible();
      },
    });
  }
  return menu;
}

function menuItemLabel(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

/**
 * The per-row "⋮" kebab button (GOS-3x follow-up, 2026-08-11) — REPLACES
 * the former two loose "Force password reset"/"Delete" buttons (and would
 * not have comfortably fit a third alongside them). Opens a 3-item menu:
 * "View" (neutral style — read-only, never destructive), "Force password
 * reset" (existing warning style), "Delete" (existing danger style).
 * Built fresh on every click (mirrors the "Columns" button's own
 * click-time construction below) so each item always closes over the
 * CURRENT `rowData`/`button` — never stale from an earlier grid render.
 */
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

    const viewItem = createMenuItem(menuItemLabel('View'), () => {
      void openUserDetailModal(rowData);
    });
    const forceResetItem = createMenuItem(
      menuItemLabel('Force password reset'),
      () => {
        void handleForcePasswordReset(rowData, button);
      },
      { variant: 'warning' },
    );
    const deleteItem = createMenuItem(
      menuItemLabel('Delete'),
      () => {
        void handleDelete(rowData, button);
      },
      { variant: 'danger' },
    );

    openDropdownMenu(button, [viewItem, forceResetItem, deleteItem]);
  });
  return button;
}

/**
 * Renders the "Actions" column: a single "⋮" kebab button opening
 * View/Force password reset/Delete.
 */
function actionsFormatter(cell) {
  const rowData = cell.getRow().getData();

  const wrapper = document.createElement('div');
  wrapper.className = 'd-flex justify-content-center';
  wrapper.appendChild(createKebabMenuButton(rowData));

  return wrapper;
}

async function handleForcePasswordReset(rowData, button) {
  // A real email to a real user — confirm first, same reasoning as any
  // other irreversible-ish action in this panel.
  const confirmed = window.confirm(
    `Send a password-reset email to ${rowData.email}?`,
  );
  if (!confirmed) {
    return;
  }

  showError('');
  showSuccess('');
  button.disabled = true;

  try {
    const body = await graphqlRequest(FORCE_RESET_MUTATION, {
      userId: rowData.id,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to force a password reset.'
          : code === 'EMAIL_DELIVERY_DISABLED' ||
              code === 'EMAIL_DELIVERY_MISCONFIGURED'
            ? 'Email delivery is currently unavailable — the reset email could not be sent.'
            : 'Could not send the password-reset email. Please try again.',
      );
      return;
    }

    showSuccess(`Password-reset email sent to ${rowData.email}.`);
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
 * Single-row Delete — plain `window.confirm()` with copy making the
 * irreversibility and blast radius explicit (mirrors the existing
 * Force-password-reset pattern; the STRONGER, itemized confirmation
 * `<dialog>` is reserved for the bulk path only, per the human's explicit
 * requirement). Reloads the grid on success. On failure, nothing changes
 * and the button simply re-enables.
 */
async function handleDelete(rowData, button) {
  const confirmed = window.confirm(
    `Permanently delete ${rowData.email}? This cannot be undone — their profile(s), sessions, and all related data will be erased forever.`,
  );
  if (!confirmed) {
    return;
  }

  showError('');
  showSuccess('');
  button.disabled = true;

  try {
    const body = await graphqlRequest(DELETE_MUTATION, { id: rowData.id });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to delete user accounts.'
          : code === 'USER_ACCOUNT_NOT_FOUND'
            ? 'This user account no longer exists.'
            : 'Could not delete this user account. Please try again.',
      );
      return;
    }

    await loadUserAccounts();
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

/**
 * Inline cell-edit handler for every editable column (firstName/lastName/
 * email/phoneCountryCode/phoneNumber/accountStatus) — sends ONLY the one
 * changed field, mirrors `settings.js`'s `handleToggle` revert-on-failure
 * pattern exactly (`cell.restoreOldValue()` is Tabulator's own equivalent of
 * `applyState(previous...)`).
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
    const body = await graphqlRequest(UPDATE_USER_ACCOUNT_MUTATION, {
      id: rowData.id,
      input: { [field]: newValue },
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to edit user accounts.'
          : code === 'USER_ACCOUNT_EMAIL_TAKEN'
            ? 'That email address is already in use by a different user account.'
            : 'Could not save the change. Please try again.',
      );
      cell.restoreOldValue();
      return;
    }

    // Editing email may have server-side-forced accountStatus back to
    // PENDING_EMAIL_VERIFICATION (see UpdateUserAccountService) — reflect
    // that in the grid's accountStatus cell without a full reload.
    const updated = body.data.updateUserAccount;
    if (field === 'email' && updated.accountStatus !== rowData.accountStatus) {
      cell.getRow().update({ accountStatus: updated.accountStatus });
    }
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
    cell.restoreOldValue();
  }
}

function dateFormatter(cell) {
  const value = cell.getValue();
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

/**
 * Same idea as `dateFormatter` above but operating on a raw ISO string
 * (not a Tabulator cell) — used by the "View" detail modal's Account tab,
 * which renders `createdAt`/`updatedAt` alongside the rest of
 * `userAccountDetail`'s plain field values, outside the grid.
 */
function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const COLUMNS = [
  // Row-selection checkbox column — powers the bulk-delete toolbar button
  // below.
  {
    formatter: 'rowSelection',
    titleFormatter: 'rowSelection',
    hozAlign: 'center',
    headerSort: false,
    headerFilter: false,
    width: 40,
    cellClick: (event, cell) => cell.getRow().toggleSelect(),
  },
  { title: 'ID', field: 'id', visible: false, headerFilter: false },
  {
    title: 'First name',
    field: 'firstName',
    editor: 'input',
    headerFilter: 'input',
    minWidth: 120,
  },
  {
    title: 'Last name',
    field: 'lastName',
    editor: 'input',
    headerFilter: 'input',
    minWidth: 120,
  },
  {
    title: 'Email',
    field: 'email',
    editor: 'input',
    headerFilter: 'input',
    minWidth: 220,
  },
  {
    title: 'Phone country code',
    field: 'phoneCountryCode',
    editor: 'input',
    headerFilter: 'input',
    minWidth: 130,
  },
  {
    title: 'Phone number',
    field: 'phoneNumber',
    editor: 'input',
    headerFilter: 'input',
    minWidth: 130,
  },
  {
    title: 'Type',
    field: 'type',
    headerFilter: 'list',
    headerFilterParams: {
      values: ['', 'Customer', 'Professional', 'Both', 'None yet'],
    },
    headerFilterFunc: '=',
    minWidth: 110,
  },
  // Read-only: which auth method this account was created/signs in with
  // (PASSWORD vs. a social provider). Never editable from the grid — how a
  // user authenticates isn't a plain data field an admin should be able to
  // silently reassign; the account's real linkage (passwordHash vs.
  // socialProviderSubject) lives entirely server-side and is never exposed
  // via `UserAccountModel` in the first place (see `ADMIN_USER_ACCOUNT_SELECT`).
  {
    title: 'Auth provider',
    field: 'authProvider',
    headerFilter: 'list',
    headerFilterParams: {
      values: ['', 'PASSWORD', 'GOOGLE', 'APPLE'],
    },
    headerFilterFunc: '=',
    minWidth: 130,
  },
  {
    title: 'Status',
    field: 'accountStatus',
    editor: 'list',
    editorParams: { values: ACCOUNT_STATUS_VALUES },
    headerFilter: 'list',
    headerFilterParams: { values: ['', ...ACCOUNT_STATUS_VALUES] },
    headerFilterFunc: '=',
    minWidth: 170,
  },
  {
    // `headerMenu` REMOVED (2026-08-11) — the column-visibility toggle it
    // used to expose here moved to the always-visible "Columns" toolbar
    // button (see this file's own header comment); keeping it here too
    // would just be a second, redundant place for the same thing.
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
    // Fixed width, not minWidth: the single "⋮" kebab button it renders
    // (2026-08-11 — was two loose buttons, 260px wide) has a known,
    // constant, much smaller footprint now.
    width: 70,
  },
];

let table = null;

function updateBulkButtonState(selectedRows) {
  const count = selectedRows.length;
  bulkDeleteButton.textContent = `Delete selected (${count})`;
  bulkDeleteButton.disabled = count === 0;
}

/**
 * Populates the itemized bulk-delete confirmation `<dialog>` — every
 * selected user's name (or "(no name)" if both firstName/lastName are
 * blank) AND email, one `<li>` per user. Deliberately NOT a count-only
 * `window.confirm()` — the human's explicit safety requirement for this
 * path specifically, with EVEN MORE reason now that the action is
 * irreversible.
 */
function populateBulkConfirmList(rows) {
  bulkConfirmListEl.textContent = '';
  for (const row of rows) {
    const li = document.createElement('li');
    const name = [row.firstName, row.lastName].filter(Boolean).join(' ');
    li.textContent = name ? `${name} — ${row.email}` : `${row.email}`;
    bulkConfirmListEl.appendChild(li);
  }
}

async function submitBulkDelete() {
  const selectedRows = table.getSelectedData();
  const ids = selectedRows.map((row) => row.id);

  bulkConfirmDialog.close();
  showError('');
  showSuccess('');
  clearBulkFeedback();
  bulkConfirmSubmitButton.disabled = true;
  bulkDeleteButton.disabled = true;

  try {
    const body = await graphqlRequest(BULK_DELETE_MUTATION, { ids });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to delete user accounts.'
          : 'Could not delete the selected user accounts. Please try again.',
      );
      return;
    }

    const { succeededIds, failed } = body.data.bulkDeleteUserAccounts;
    renderBulkFeedback(selectedRows, succeededIds, failed);
    table.deselectRow();
    await loadUserAccounts();
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    bulkConfirmSubmitButton.disabled = false;
    updateBulkButtonState(table.getSelectedRows());
  }
}

bulkDeleteButton.addEventListener('click', () => {
  const selectedRows = table?.getSelectedData() ?? [];
  if (selectedRows.length === 0) {
    return;
  }
  populateBulkConfirmList(selectedRows);
  bulkConfirmDialog.showModal();
});

bulkConfirmCancelButton.addEventListener('click', () => {
  bulkConfirmDialog.close();
});

bulkConfirmSubmitButton.addEventListener('click', () => {
  void submitBulkDelete();
});

/**
 * "Columns" toolbar button (GOS-3x follow-up, 2026-08-11) — opens the
 * SAME column-visibility menu content `columnVisibilityHeaderMenu` has
 * always built, now from one always-visible, discoverable toolbar button
 * instead of a menu hidden inside the "Created At" column header. Built
 * fresh on every click (mirrors Tabulator's own original behavior of
 * rebuilding the menu each time it opens, so checkbox `checked` state is
 * always read fresh from the table's current column visibility). No-ops
 * before the table exists yet (the very first render, before
 * `loadUserAccounts` resolves) — there is nothing to toggle yet.
 */
columnsButton.addEventListener('click', () => {
  if (!table) {
    return;
  }
  const menuEntries = columnVisibilityHeaderMenu.call(table);
  const items = menuEntries.map((entry) =>
    createMenuItem(entry.label, entry.action, { keepOpen: true }),
  );
  openDropdownMenu(columnsButton, items);
});

/**
 * Created ONCE — `#usuarios-grid` (the mount container) persists across
 * section show/hide (only `hidden` toggles, see `js/nav.js`), so
 * re-creating a fresh Tabulator instance on every show would leak
 * instances/listeners. Subsequent calls to `loadUserAccounts` (this
 * section's `onShow` callback) reuse the already-built instance and call
 * `table.setData(...)` instead.
 *
 * `initialData` is passed straight into the constructor (`data: initialData`)
 * rather than always constructing empty and immediately calling
 * `.setData()` — confirmed LIVE (via a real, Playwright-driven crash) that
 * calling `.setData()` synchronously right after `new Tabulator(...)`
 * throws (`Cannot read properties of null (reading 'verticalFillMode')`,
 * inside Tabulator's own `rowManager.adjustTableSize()`): the table's
 * internal renderer is not yet initialized at that point — Tabulator's own
 * build-out is asynchronous. Passing the first page of data directly into
 * the constructor is Tabulator's own documented, race-free way to seed
 * initial data; only RELOADS (the table already fully built) use
 * `.setData()`, which is safe once `tableBuilt` has already fired.
 *
 * `persistence: { columns: true }` — Tabulator's OWN built-in
 * localStorage-backed column layout/order/visibility persistence. This is
 * NOT the same concern as this panel's "no localStorage for the session
 * token" security rule (see `js/session.js`'s own header comment): a saved
 * column layout preference carries zero security/PII sensitivity — it is
 * only ever "which columns were visible/in what order", never any account
 * data or credential. Do not "fix" this into non-persistence by mistaken
 * analogy to the session-token rule; they are unrelated concerns.
 *
 * `selectableRows: true` — enables multi-row selection (the checkbox column
 * above), which powers the bulk-delete toolbar button.
 *
 * `layout: 'fitDataStretch'` (2026-08-11 follow-up — was `'fitColumns'`):
 * `fitColumns` forces every column to squeeze into the container's width no
 * matter how many there are, which — once the "Auth provider" column made
 * this an 11-column grid — started silently clipping columns off the right
 * edge instead of ever showing a scrollbar (`fitColumns` never produces
 * horizontal overflow by design, it just keeps shrinking columns, and past
 * each column's `minWidth` floor the excess has nowhere to go but off-
 * screen). `fitDataStretch` sizes each column to its content/`minWidth`
 * (set per-column above) and only stretches the LAST column to fill any
 * leftover space when everything already fits — once the columns' combined
 * width exceeds the container, `#usuarios-grid`'s own `overflow-x: auto`
 * (see `css/tabulator-theme.css`) now lets Tabulator's native horizontal
 * scrollbar take over instead. Confirmed live: with all 11 columns visible,
 * the grid scrolls horizontally and every column (including "Actions")
 * stays fully readable, rather than being crushed or cut off.
 */
function buildTable(initialData) {
  table = new Tabulator(gridEl, {
    columns: COLUMNS,
    data: initialData,
    layout: 'fitDataStretch',
    movableColumns: true,
    selectableRows: true,
    persistence: { columns: true },
    // Bumped from 'goservice-admin-user-accounts' (2026-08-11, same round as
    // the fitColumns -> fitDataStretch change above): Tabulator's
    // localStorage persistence saves each column's actual rendered pixel
    // width, and every browser that already viewed this grid under the old
    // fitColumns layout has cramped, artificially-shrunk widths saved under
    // the old key. Reusing that key would silently reapply those stale
    // widths on top of the new layout, undoing this fix for any admin who's
    // opened this screen before. A fresh key starts everyone from the new
    // minWidth-based defaults instead.
    persistenceID: 'goservice-admin-user-accounts-v2',
    placeholder: 'No user accounts found.',
  });
  table.on('cellEdited', (cell) => {
    void handleCellEdited(cell);
  });
  table.on('rowSelectionChanged', (data, rows) => {
    updateBulkButtonState(rows);
  });
}

// ---------------------------------------------------------------------
// "View" row-detail modal (GOS-3x follow-up, 2026-08-11) — fetches
// `userAccountDetail(id)` on demand when opened, renders a tabbed
// Account/Customer profile/Professional profile/Activity view. Every
// piece of dynamic content below is built via `document.createElement`,
// never `innerHTML` — same convention as the rest of this panel.
// ---------------------------------------------------------------------

function showDetailError(message) {
  detailErrorEl.textContent = message;
  detailErrorEl.hidden = message === '';
}

/** One labeled field row (`label` above, `value` below) — `value` falls
 * back to an em dash when blank/nullish, never a raw empty string. */
function buildPhoto(photoUrl, name) {
  if (!photoUrl) {
    return null;
  }
  const img = document.createElement('img');
  img.className = 'gs-detail-photo';
  img.src = photoUrl;
  img.alt = `${name}'s photo`;
  return img;
}

/** "Account" tab — always present, base identity fields only (same set
 * `UserAccountModel`/the grid already exposes, plus the two timestamps). */
function buildAccountTabContent(detail) {
  const wrapper = document.createElement('div');
  const fullName =
    [detail.firstName, detail.lastName].filter(Boolean).join(' ') || null;
  const phone =
    detail.phoneCountryCode || detail.phoneNumber
      ? `${detail.phoneCountryCode ?? ''} ${detail.phoneNumber ?? ''}`.trim()
      : null;

  wrapper.append(
    buildField('Full name', fullName),
    buildField('Email', detail.email),
    buildField('Phone', phone),
    buildField('Account status', detail.accountStatus),
    buildField('Auth provider', detail.authProvider),
    buildField('Created at', formatDateTime(detail.createdAt)),
    buildField('Updated at', formatDateTime(detail.updatedAt)),
  );
  return wrapper;
}

/** "Customer profile" tab — only rendered/added when `hasCustomerProfile`
 * is true (see `openUserDetailModal`). A "Address" sub-section groups
 * addressLine/city/province/country, visually separated per the human's
 * explicit requirement. */
function buildCustomerProfileTabContent(profile) {
  const wrapper = document.createElement('div');

  const photo = buildPhoto(
    profile.photoUrl,
    `${profile.firstName} ${profile.lastName}`,
  );
  if (photo) {
    wrapper.appendChild(photo);
  }
  wrapper.appendChild(buildField('First name', profile.firstName));
  wrapper.appendChild(buildField('Last name', profile.lastName));
  // Boolean, not a free-text value — passed as an explicit 'Yes'/'No' string
  // rather than the raw boolean, since `buildField` renders a falsy value
  // (including `false`) as '—' via `value || '—'`.
  wrapper.appendChild(
    buildField(
      'Location sharing',
      profile.locationSharingEnabled ? 'Yes' : 'No',
    ),
  );

  wrapper.appendChild(
    buildSubsection('Address', [
      buildField('Address', profile.addressLine),
      buildField('City', profile.city),
      buildField('Province', profile.province),
      buildField('Country', profile.country),
    ]),
  );

  return wrapper;
}

/** "Professional profile" tab — only rendered/added when
 * `hasProfessionalProfile` is true. "Service area" and "Specializations"
 * sub-sections, visually separated, per the human's explicit requirement. */
function buildProfessionalProfileTabContent(profile) {
  const wrapper = document.createElement('div');

  const photo = buildPhoto(
    profile.photoUrl,
    `${profile.firstName} ${profile.lastName}`,
  );
  if (photo) {
    wrapper.appendChild(photo);
  }
  wrapper.append(
    buildField('First name', profile.firstName),
    buildField('Last name', profile.lastName),
    buildField('Nombre comercial', profile.displayName),
    buildField('Bio', profile.bio),
    buildField('Verification status', profile.verificationStatus),
    buildField(
      'Languages',
      profile.languages && profile.languages.length > 0
        ? profile.languages.join(', ')
        : null,
    ),
    // Boolean, not a free-text value — passed as an explicit 'Yes'/'No'
    // string rather than the raw boolean, since `buildField` renders a
    // falsy value (including `false`) as '—' via `value || '—'`.
    buildField(
      'Location sharing',
      profile.locationSharingEnabled ? 'Yes' : 'No',
    ),
  );

  wrapper.appendChild(
    buildSubsection('Service area', [
      buildField('City', profile.city),
      buildField('Country', profile.country),
      buildField('Service area description', profile.serviceAreaDescription),
    ]),
  );

  const specializationNodes = [];
  if (!profile.specializations || profile.specializations.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-secondary mb-0';
    empty.textContent = 'No specializations listed.';
    specializationNodes.push(empty);
  } else {
    for (const specialization of profile.specializations) {
      const item = document.createElement('div');
      item.className = 'gs-detail-specialization';
      item.append(
        buildField('Category', specialization.category.name),
        buildField('Role', specialization.role),
        buildField('Description', specialization.description),
        buildField(
          'Years of experience',
          specialization.yearsOfExperience != null
            ? String(specialization.yearsOfExperience)
            : null,
        ),
        buildField('Order', String(specialization.order)),
      );
      specializationNodes.push(item);
    }
  }
  wrapper.appendChild(buildSubsection('Specializations', specializationNodes));

  return wrapper;
}

/** "Activity" tab — still a placeholder, but no longer a false one:
 * ServiceRequest now exists (GOS-38, 2026-08-18) and is browsable/filterable
 * by this same user's email from the dedicated "Service Requests" grid
 * (Customer/Email columns) — this tab does not yet embed that list inline,
 * which remains a real, scoped-out follow-up (would need a
 * customerProfileId/userId filter argument `serviceRequests` doesn't have
 * yet — see that query's own phase-1-scope description). Quote/Engagement
 * still genuinely don't exist in this backend. NO fabricated data either
 * way. */
function buildActivityTabContent() {
  const wrapper = document.createElement('div');
  const placeholder = document.createElement('p');
  placeholder.className = 'text-secondary mb-0';
  placeholder.textContent =
    'Not shown here yet — see this user\'s service requests in the "Service Requests" grid (filter by their email). Quotes and engagements will appear here once those capabilities exist.';
  wrapper.appendChild(placeholder);
  return wrapper;
}

/**
 * Opens `#usuarios-detail-dialog` and fetches `userAccountDetail(id)` for
 * `rowData` — never pre-loaded alongside the grid's own lightweight
 * `USER_ACCOUNTS_QUERY`. Shows a loading state while in flight, then
 * either the tabbed content or an error (same `ADMIN_UNAUTHENTICATED` ->
 * logout / other-errors -> banner handling as the rest of this panel).
 */
async function openUserDetailModal(rowData) {
  closeDropdownMenu();
  detailContentEl.textContent = '';
  showDetailError('');
  detailLoadingEl.hidden = false;
  detailDialog.showModal();

  try {
    const body = await graphqlRequest(USER_ACCOUNT_DETAIL_QUERY, {
      id: rowData.id,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        detailDialog.close();
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showDetailError(
        code === 'USER_ACCOUNT_NOT_FOUND'
          ? 'This user account no longer exists.'
          : 'Could not load this user account. Please try again.',
      );
      return;
    }

    const detail = body.data.userAccountDetail;
    const tabs = [
      {
        id: 'account',
        label: 'Account',
        content: buildAccountTabContent(detail),
      },
    ];
    if (detail.hasCustomerProfile && detail.customerProfile) {
      tabs.push({
        id: 'customer',
        label: 'Customer profile',
        content: buildCustomerProfileTabContent(detail.customerProfile),
      });
    }
    if (detail.hasProfessionalProfile && detail.professionalProfile) {
      tabs.push({
        id: 'professional',
        label: 'Professional profile',
        content: buildProfessionalProfileTabContent(detail.professionalProfile),
      });
    }
    tabs.push({
      id: 'activity',
      label: 'Activity',
      content: buildActivityTabContent(),
    });

    detailContentEl.appendChild(
      renderDetailTabs(tabs, {
        idPrefix: 'usuarios-detail',
        ariaLabel: 'User detail sections',
      }),
    );
  } catch (error) {
    showDetailError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    detailLoadingEl.hidden = true;
  }
}

detailCloseButton.addEventListener('click', () => {
  detailDialog.close();
});

export async function loadUserAccounts() {
  showError('');
  showSuccess('');
  clearBulkFeedback();

  try {
    const body = await graphqlRequest(USER_ACCOUNTS_QUERY, {
      limit: FETCH_LIMIT,
      offset: 0,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      showError('Could not load user accounts.');
      return;
    }

    const items = body.data.userAccounts.items.map((item) => ({
      ...item,
      type: deriveType(item),
    }));

    if (table) {
      await table.setData(items);
      // A full data reload invalidates any prior selection — keep the bulk
      // toolbar button's count/disabled state in sync.
      updateBulkButtonState([]);
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
