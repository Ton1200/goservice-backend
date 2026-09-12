// GOS-121 admin follow-up (human-requested, added after the backend-only
// ship) — "Reviews" section: a real, functional data grid over `Review`
// (`adminReviews`/`moderateEngagementReviewComment`, `/admin/graphql` only),
// mirroring `js/quotes.js`'s grid conventions exactly (Tabulator, the same
// `graphqlRequest`/`handleAdminUnauthenticated`/`showError` plumbing,
// `document.createElement`-only DOM building) — but with real row actions
// (Approve/Reject a PENDING comment), unlike that fully read-only grid.
//
// `AdminReview` carries NO denormalized names (no Customer/Professional/
// ServiceRequest join) — only a raw `engagementId`. This grid deliberately
// does not fabricate one either (same "never fabricate a join the schema
// doesn't provide" restraint `js/serviceRequests.js`'s own header comment
// documents for its own cross-navigation trim) — an admin who needs the
// human context for a review opens that Engagement's Quote from the Quotes
// grid instead, where the SAME review now also shows up as a "Reviews" tab
// on the Quote detail modal (see `js/quotes.js`).
//
// `AdminReviewsFilterInput` is the FIRST real server-side filter argument
// anywhere in this admin panel (every other grid is limit/offset-only with
// client-side Tabulator header-filters over one fetched page — see
// `js/serviceRequests.js`'s own `FETCH_LIMIT` comment). This grid keeps that
// same client-side-filter convention for everything EXCEPT moderation
// status: a dedicated toolbar dropdown re-fetches from the server with
// `filter: { commentModerationStatus }` — the common "show me the PENDING
// queue" view is cheap and exact to ask the server for directly, rather
// than filtering a merely-200-row client-side page that may not even
// contain every PENDING row.
import { TabulatorFull as Tabulator } from '../vendor/tabulator/js/tabulator_esm.min.mjs';
import { graphqlRequest, GraphQLNetworkError } from './graphqlClient.js';
import { createMenuItem, openDropdownMenu } from './dropdownMenu.js';
import { formatRating } from './detailView.js';
import { clearSession } from './session.js';
import { showLoginView } from './view.js';

const ADMIN_REVIEWS_QUERY = `
  query AdminReviews($filter: AdminReviewsFilterInput, $limit: Int, $offset: Int) {
    adminReviews(filter: $filter, limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items {
        id
        engagementId
        authorRole
        rating
        comment
        commentModerationStatus
        moderatedByAdminUserId
        moderatedAt
        createdAt
      }
    }
  }
`;

const MODERATE_REVIEW_MUTATION = `
  mutation ModerateEngagementReviewComment($reviewId: ID!, $decision: ReviewModerationDecision!) {
    moderateEngagementReviewComment(reviewId: $reviewId, decision: $decision) {
      id
      commentModerationStatus
      moderatedByAdminUserId
      moderatedAt
    }
  }
`;

// Same phase-1 scope boundary as every other grid's own FETCH_LIMIT — one
// bounded page (the server-enforced max, see `ListAdminReviewsService`),
// Tabulator's own header filters do client-side filtering/sorting on it.
const FETCH_LIMIT = 200;

// Mirrors `ReviewCommentModerationStatus`/`EngagementReviewParty`
// (prisma/schema.prisma). Hardcoded here deliberately — same trade-off
// every other grid's own *_VALUES list already accepts (no build step/
// codegen, and introspection is disabled by default).
const AUTHOR_ROLE_VALUES = ['CUSTOMER', 'PROFESSIONAL'];
const MODERATION_STATUS_VALUES = ['PENDING', 'APPROVED', 'REJECTED'];

const gridEl = document.getElementById('reviews-grid');
const errorEl = document.getElementById('reviews-error');
const successEl = document.getElementById('reviews-success');
const columnsButton = document.getElementById('reviews-columns-button');
const statusFilterSelect = document.getElementById('reviews-status-filter');

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = message === '';
}

function showSuccess(message) {
  successEl.textContent = message;
  successEl.hidden = message === '';
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

function dateFormatter(cell) {
  const value = cell.getValue();
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function ratingFormatter(cell) {
  return formatRating(cell.getValue());
}

/** A raw UUID is too wide for a comfortable column — shown truncated, full
 * value always available via `tooltip: true` (same convention as every
 * long-text column in this panel, e.g. `Description`/`Message`). */
function engagementIdFormatter(cell) {
  const value = cell.getValue();
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function moderationStatusFormatter(cell) {
  return cell.getValue() ?? '—';
}

function commentFormatter(cell) {
  return cell.getValue() ?? '—';
}

/**
 * Approve/Reject, only for a comment currently `PENDING` — a `null`
 * `commentModerationStatus` (no comment submitted at all) or an already
 * `APPROVED`/`REJECTED` one (a decision is terminal — see
 * `ModerateEngagementReviewCommentService`'s own header comment: never
 * reverted) renders nothing here, same "nothing to do" empty-wrapper shape
 * `js/serviceRequests.js`'s own `actionsFormatter` would use if it ever
 * needed a conditional action.
 */
function actionsFormatter(cell) {
  const rowData = cell.getRow().getData();
  const wrapper = document.createElement('div');
  wrapper.className = 'd-flex justify-content-center gap-1';

  if (rowData.commentModerationStatus !== 'PENDING') {
    return wrapper;
  }

  const approveButton = document.createElement('button');
  approveButton.type = 'button';
  approveButton.className = 'btn btn-sm btn-outline-success';
  approveButton.textContent = 'Approve';
  approveButton.addEventListener('click', () => {
    void handleModerate(rowData.id, 'APPROVE', approveButton);
  });

  const rejectButton = document.createElement('button');
  rejectButton.type = 'button';
  rejectButton.className = 'btn btn-sm btn-outline-danger';
  rejectButton.textContent = 'Reject';
  rejectButton.addEventListener('click', () => {
    void handleModerate(rowData.id, 'REJECT', rejectButton);
  });

  wrapper.append(approveButton, rejectButton);
  return wrapper;
}

/**
 * Approve/Reject a review comment — `window.confirm` -> mutate -> reload the
 * whole grid, same "confirm, mutate, then re-fetch the section's own load
 * function" shape `js/categories.js`'s `handleDelete` already establishes.
 * A full `loadReviews()` re-fetch (rather than patching just this row) keeps
 * the grid honest against the toolbar's own status filter — an approved/
 * rejected row may no longer belong in a "PENDING only" filtered view.
 */
async function handleModerate(reviewId, decision, button) {
  const confirmed = window.confirm(
    decision === 'APPROVE'
      ? 'Approve this review comment? It will become visible to the counterparty once the double-blind window resolves.'
      : 'Reject this review comment? This cannot be undone — the text stays hidden from the counterparty forever, but the rating itself is unaffected.',
  );
  if (!confirmed) {
    return;
  }

  showError('');
  showSuccess('');
  button.disabled = true;

  try {
    const body = await graphqlRequest(MODERATE_REVIEW_MUTATION, {
      reviewId,
      decision,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to moderate reviews.'
          : code === 'REVIEW_COMMENT_ALREADY_MODERATED'
            ? 'This review comment has already been moderated — refreshing the grid.'
            : code === 'REVIEW_NOT_FOUND'
              ? 'This review no longer exists — refreshing the grid.'
              : 'Could not moderate this review. Please try again.',
      );
      await loadReviews();
      return;
    }

    showSuccess(
      decision === 'APPROVE'
        ? 'Review comment approved.'
        : 'Review comment rejected.',
    );
    await loadReviews();
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

const COLUMNS = [
  { title: 'ID', field: 'id', visible: false, headerFilter: false },
  {
    title: 'Engagement',
    field: 'engagementId',
    formatter: engagementIdFormatter,
    headerFilter: 'input',
    tooltip: true,
    minWidth: 130,
  },
  {
    title: 'Author',
    field: 'authorRole',
    headerFilter: 'list',
    headerFilterParams: { values: ['', ...AUTHOR_ROLE_VALUES] },
    headerFilterFunc: '=',
    minWidth: 130,
  },
  {
    title: 'Rating',
    field: 'rating',
    formatter: ratingFormatter,
    headerFilter: false,
    minWidth: 140,
  },
  {
    title: 'Comment',
    field: 'comment',
    formatter: commentFormatter,
    headerFilter: 'input',
    // Standing long-text-column convention (see `css/tabulator-theme.css`'s
    // own `.gs-truncate-cell` comment) — deliberately NO `maxWidth`, same
    // reasoning as every other long-text column in this panel.
    minWidth: 220,
    cssClass: 'gs-truncate-cell',
    tooltip: true,
  },
  {
    title: 'Moderation',
    field: 'commentModerationStatus',
    formatter: moderationStatusFormatter,
    headerFilter: 'list',
    headerFilterParams: { values: ['', ...MODERATION_STATUS_VALUES] },
    headerFilterFunc: '=',
    minWidth: 130,
  },
  {
    title: 'Moderated At',
    field: 'moderatedAt',
    formatter: dateFormatter,
    headerFilter: false,
    minWidth: 150,
  },
  {
    title: 'Created At',
    field: 'createdAt',
    formatter: dateFormatter,
    headerFilter: false,
    minWidth: 150,
  },
  {
    title: 'Actions',
    formatter: actionsFormatter,
    headerFilter: false,
    headerSort: false,
    hozAlign: 'center',
    minWidth: 160,
  },
];

let table = null;

/**
 * Builds the "Columns" toolbar button's menu content — IDENTICAL logic to
 * every other grid's own `columnVisibilityMenu` (`js/serviceRequests.js`/
 * `js/quotes.js`). Must be called with `this` bound to the Tabulator table
 * instance (`columnVisibilityMenu.call(table)`).
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
    return; // Nothing to toggle yet — before the first loadReviews() resolves.
  }
  const menuEntries = columnVisibilityMenu.call(table);
  const items = menuEntries.map((entry) =>
    createMenuItem(entry.label, entry.action, { keepOpen: true }),
  );
  openDropdownMenu(columnsButton, items);
});

/**
 * Same "create once, reuse across section show/hide, .setData() on
 * reloads" convention as every other grid's own `buildTable`.
 */
function buildTable(initialData) {
  table = new Tabulator(gridEl, {
    columns: COLUMNS,
    data: initialData,
    layout: 'fitDataStretch',
    movableColumns: true,
    persistence: { columns: true },
    persistenceID: 'goservice-admin-reviews-v1',
    placeholder: 'No reviews found.',
  });
}

statusFilterSelect.addEventListener('change', () => {
  void loadReviews();
});

export async function loadReviews() {
  showError('');
  showSuccess('');

  const selectedStatus = statusFilterSelect.value;

  try {
    const body = await graphqlRequest(ADMIN_REVIEWS_QUERY, {
      filter: selectedStatus
        ? { commentModerationStatus: selectedStatus }
        : undefined,
      limit: FETCH_LIMIT,
      offset: 0,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to view reviews.'
          : 'Could not load reviews.',
      );
      return;
    }

    const items = body.data.adminReviews.items;

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
