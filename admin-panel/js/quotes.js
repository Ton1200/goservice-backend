// Quotes admin grid follow-up (2026-08-19) — "Quotes" section: a real,
// functional, READ-ONLY data grid over `Quote` (`quotes`/`quoteDetail`,
// `/admin/graphql` only), mirroring `js/serviceRequests.js`'s grid/
// detail-modal conventions exactly (Tabulator, the same
// `graphqlRequest`/`handleAdminUnauthenticated`/`showError` plumbing,
// `document.createElement`-only DOM building). Even simpler than that file:
// no "create on behalf of" flow exists here either — a Quote always needs a
// real ProfessionalProfile submitting against a real OPEN ServiceRequest, so
// there is no sensible admin-initiated "create" analog (see
// `AdminQuotesResolver`'s own header comment). Exactly one row action
// ("View"), same as Service Requests.
//
// Every row/detail carries the "relación de usuarios" explicitly, TWICE
// over: which Customer owns the parent ServiceRequest, AND which
// Professional submitted this Quote — see `serviceRequest.customerProfile`/
// `professional` on both `QUOTES_QUERY` and `QUOTE_DETAIL_QUERY` below.
import { TabulatorFull as Tabulator } from '../vendor/tabulator/js/tabulator_esm.min.mjs';
import { graphqlRequest, GraphQLNetworkError } from './graphqlClient.js';
import { createMenuItem, openDropdownMenu } from './dropdownMenu.js';
import {
  buildBadgeField,
  buildField,
  buildStatusBadge,
  buildSubsection,
  renderDetailTabs,
} from './detailView.js';
import { clearSession } from './session.js';
import { showLoginView } from './view.js';

const QUOTES_QUERY = `
  query Quotes($limit: Int, $offset: Int) {
    quotes(limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items {
        id
        price
        finalPrice
        negotiationMessageCount
        message
        status
        createdAt
        serviceRequest {
          id
          description
          status
          category { id name }
          customerProfile { id userId displayName email firstName lastName }
        }
        professional { id userId displayName email firstName lastName }
      }
    }
  }
`;

// "View" row action — fetched lazily, on demand, when the detail modal
// opens; never pre-loaded alongside the grid's own lightweight
// `QUOTES_QUERY` above.
const QUOTE_DETAIL_QUERY = `
  query QuoteDetail($id: ID!) {
    quoteDetail(id: $id) {
      id
      price
      negotiatedPrice
      message
      status
      negotiationMessageCount
      createdAt
      updatedAt
      serviceRequest {
        id
        description
        status
        category { id name }
        customerProfile { id userId displayName email firstName lastName }
      }
      professional { id userId displayName email firstName lastName }
      engagement { id status createdAt }
    }
  }
`;

// "Negotiation" tab — fetched lazily, only the first time that tab is
// actually activated (see `renderDetailTabs`'s `onActivate` — most admins
// never open this tab, so it's never pre-loaded alongside `QUOTE_DETAIL_QUERY`
// above). Gated server-side by `Permission.QUOTE_NEGOTIATION_READ` PLUS
// `quote-negotiation.general.enabled` (`AdminQuoteNegotiationResolver`) —
// both failure modes are handled explicitly in `loadNegotiationThread`
// below, scoped to this tab only, never a page-wide crash.
const QUOTE_NEGOTIATION_THREAD_QUERY = `
  query AdminQuoteNegotiationThread($quoteId: ID!) {
    adminQuoteNegotiationThread(quoteId: $quoteId) {
      id
      authorRole
      message
      createdAt
      priceProposal {
        id
        proposedByRole
        proposedPrice
        status
        resolvedAt
        createdAt
      }
    }
  }
`;

// "Chat" tab (GOS-46 follow-up, 2026-08-21) — fetched lazily, only the first
// time that tab is actually activated, same convention as
// `QUOTE_NEGOTIATION_THREAD_QUERY` above. Only meaningful once
// `detail.engagement` exists (see `openQuoteDetailModal`'s tab-building
// logic) — Engagement Chat only ever exists once a Quote's Engagement
// exists. Gated server-side by `Permission.ENGAGEMENT_CHAT_READ` only —
// unlike `adminQuoteNegotiationThread`, this query is deliberately NOT
// gated by any module-enabled feature flag (see
// `AdminEngagementChatResolver`'s own header comment), so
// `ENGAGEMENT_CHAT_MODULE_DISABLED` is never expected here and is not
// special-cased in `loadEngagementChatThread` below.
const ADMIN_ENGAGEMENT_CHAT_THREAD_QUERY = `
  query AdminEngagementChatThread($engagementId: ID!) {
    adminEngagementChatThread(engagementId: $engagementId) {
      id
      conversationId
      senderRole
      content
      createdAt
    }
  }
`;

// Same phase-1 scope boundary as `js/serviceRequests.js`'s own FETCH_LIMIT —
// one bounded page (the server-enforced max, see `ListAdminQuotesService`),
// Tabulator's own header filters do client-side filtering/sorting on it.
const FETCH_LIMIT = 200;

// Mirrors QuoteStatus/EngagementStatus (prisma/schema.prisma). Hardcoded
// here deliberately — same trade-off `serviceRequests.js`'s own
// URGENCY_VALUES/STATUS_VALUES already accept (no build step/codegen, and
// introspection is disabled by default).
const STATUS_VALUES = ['SENT', 'WITHDRAWN', 'REJECTED', 'ACCEPTED'];

const gridEl = document.getElementById('quotes-grid');
const errorEl = document.getElementById('quotes-error');
const successEl = document.getElementById('quotes-success');
const columnsButton = document.getElementById('quotes-columns-button');
const detailDialog = document.getElementById('quotes-detail-dialog');
const detailCloseButton = document.getElementById('quotes-detail-close');
const detailErrorEl = document.getElementById('quotes-detail-error');
const detailLoadingEl = document.getElementById('quotes-detail-loading');
const detailContentEl = document.getElementById('quotes-detail-content');

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = message === '';
}

// No mutation exists on this read-only grid, so nothing ever calls
// `showSuccess` today — the element/function are still kept (rather than
// omitted) purely for structural consistency with every other admin
// section's `error`/`success` alert pair, in case a future write action
// (e.g. an admin-forced withdraw) is ever added here.
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
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

/** Same idea as `dateFormatter` but on a raw ISO string, outside the grid —
 * used by the "View" detail modal, mirrors `serviceRequests.js`'s
 * `formatDateTime`. */
function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function priceFormatter(cell) {
  const value = cell.getValue();
  return value == null ? '—' : `$${value}`;
}

/** Grid-cell version of the "does this Quote have negotiation activity"
 * signal — same `negotiationMessageCount` field the detail popup's
 * "Negotiation" tab uses to decide whether to fetch the thread at all (see
 * `loadNegotiationThread`). Kept as a plain count, not a fetch — the grid
 * must stay one lightweight `quotes(limit, offset)` call, never N+1 into
 * `adminQuoteNegotiationThread` per row. */
function negotiationCountFormatter(cell) {
  const count = cell.getValue();
  return count > 0 ? `💬 ${count}` : '—';
}

function fullNameOrDisplayName(person) {
  const fullName = [person.firstName, person.lastName]
    .filter(Boolean)
    .join(' ');
  return fullName || person.displayName;
}

function serviceRequestSummaryFormatter(cell) {
  const serviceRequest = cell.getRow().getData().serviceRequest;
  const truncated =
    serviceRequest.description.length > 60
      ? `${serviceRequest.description.slice(0, 60)}…`
      : serviceRequest.description;
  return `${serviceRequest.category.name} — ${truncated}`;
}

function customerNameFormatter(cell) {
  return fullNameOrDisplayName(
    cell.getRow().getData().serviceRequest.customerProfile,
  );
}

function customerEmailFormatter(cell) {
  return cell.getRow().getData().serviceRequest.customerProfile.email;
}

function professionalNameFormatter(cell) {
  return fullNameOrDisplayName(cell.getRow().getData().professional);
}

function professionalEmailFormatter(cell) {
  return cell.getRow().getData().professional.email;
}

function actionsFormatter(cell) {
  const rowData = cell.getRow().getData();

  const wrapper = document.createElement('div');
  wrapper.className = 'd-flex justify-content-center';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm btn-outline-secondary';
  button.textContent = 'View';
  button.addEventListener('click', () => {
    void openQuoteDetailModal(rowData);
  });

  wrapper.appendChild(button);
  return wrapper;
}

const COLUMNS = [
  { title: 'ID', field: 'id', visible: false, headerFilter: false },
  {
    title: 'Service Request',
    field: 'serviceRequestSummary',
    formatter: serviceRequestSummaryFormatter,
    headerFilter: 'input',
    // Standing long-text-column convention (see `css/tabulator-theme.css`'s
    // own `.gs-truncate-cell` comment). `serviceRequestSummaryFormatter`
    // itself already hard-truncates the description to 60 chars — this
    // `tooltip` still reveals the FULL, untruncated description (category +
    // complete text). Deliberately NO `maxWidth` — see `Message` column
    // below (and `serviceRequests.js`'s Description column) for why: it
    // fought Tabulator's own drag-to-resize, inconsistent with every other
    // column in every grid, which only ever set `minWidth`.
    minWidth: 200,
    cssClass: 'gs-truncate-cell',
    tooltip: (event, cell) => {
      const serviceRequest = cell.getRow().getData().serviceRequest;
      return `${serviceRequest.category.name} — ${serviceRequest.description}`;
    },
  },
  {
    title: 'Customer',
    field: 'customerName',
    formatter: customerNameFormatter,
    headerFilter: 'input',
    minWidth: 160,
  },
  {
    title: 'Customer Email',
    field: 'customerEmail',
    formatter: customerEmailFormatter,
    headerFilter: 'input',
    minWidth: 200,
  },
  {
    title: 'Professional',
    field: 'professionalName',
    formatter: professionalNameFormatter,
    headerFilter: 'input',
    minWidth: 160,
  },
  {
    title: 'Professional Email',
    field: 'professionalEmail',
    formatter: professionalEmailFormatter,
    headerFilter: 'input',
    minWidth: 200,
  },
  {
    title: 'Price',
    field: 'price',
    formatter: priceFormatter,
    headerFilter: false,
    minWidth: 100,
  },
  {
    // The price that actually counts once a negotiation resolved one —
    // `Quote.finalPrice` on the server is `negotiatedPrice ?? price`, so
    // this column reads the same for every row whether or not it was ever
    // negotiated; no client-side fallback logic needed here. Sits right
    // next to `Price` so a difference between the two is obvious at a
    // glance without opening the detail popup.
    title: 'Final Price',
    field: 'finalPrice',
    formatter: priceFormatter,
    headerFilter: false,
    minWidth: 110,
  },
  {
    title: 'Negotiation',
    field: 'negotiationMessageCount',
    formatter: negotiationCountFormatter,
    headerFilter: false,
    headerSort: false,
    hozAlign: 'center',
    minWidth: 110,
  },
  {
    title: 'Message',
    field: 'message',
    headerFilter: 'input',
    // Standing long-text-column convention (see `css/tabulator-theme.css`'s
    // own `.gs-truncate-cell` comment) — was `formatter: 'textarea'`.
    // Deliberately NO `maxWidth` — fights Tabulator's own drag-to-resize
    // (the column snaps back to the cap instead of staying where dragged),
    // inconsistent with every other column in every grid here, which only
    // ever sets `minWidth`.
    minWidth: 200,
    cssClass: 'gs-truncate-cell',
    tooltip: true,
  },
  {
    title: 'Status',
    field: 'status',
    headerFilter: 'list',
    headerFilterParams: { values: ['', ...STATUS_VALUES] },
    headerFilterFunc: '=',
    minWidth: 110,
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
    width: 90,
  },
];

let table = null;

/**
 * Builds the "Columns" toolbar button's menu content — IDENTICAL logic to
 * `js/serviceRequests.js`'s own `columnVisibilityMenu`. Must be called with
 * `this` bound to the Tabulator table instance
 * (`columnVisibilityMenu.call(table)`) — `this.getColumns()` relies on it.
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
    return; // Nothing to toggle yet — before the first loadQuotes() resolves.
  }
  const menuEntries = columnVisibilityMenu.call(table);
  const items = menuEntries.map((entry) =>
    createMenuItem(entry.label, entry.action, { keepOpen: true }),
  );
  openDropdownMenu(columnsButton, items);
});

/**
 * Same "create once, reuse across section show/hide, .setData() on
 * reloads" convention as `js/serviceRequests.js`'s own `buildTable`.
 */
function buildTable(initialData) {
  table = new Tabulator(gridEl, {
    columns: COLUMNS,
    data: initialData,
    layout: 'fitDataStretch',
    movableColumns: true,
    persistence: { columns: true },
    persistenceID: 'goservice-admin-quotes-v1',
    placeholder: 'No quotes found.',
  });
}

// ---------------------------------------------------------------------
// "View" row-detail modal — fetches `quoteDetail(id)` on demand. Built
// entirely via `document.createElement`, never `innerHTML` — same
// convention as `js/serviceRequests.js`.
// ---------------------------------------------------------------------

function showDetailError(message) {
  detailErrorEl.textContent = message;
  detailErrorEl.hidden = message === '';
}

function priceFormatterValue(value) {
  return value == null ? '—' : `$${value}`;
}

// Status -> badge-variant lookup tables (redesign follow-up, 2026-08-21) —
// mirrors `prisma/schema.prisma`'s `QuoteStatus`/`QuotePriceProposalStatus`
// enum values, same hardcoded-here trade-off `STATUS_VALUES` above already
// accepts (no build step/codegen, introspection disabled by default).
const QUOTE_STATUS_VARIANTS = {
  SENT: 'info',
  ACCEPTED: 'success',
  REJECTED: 'error',
  WITHDRAWN: 'neutral',
};

const PRICE_PROPOSAL_STATUS_VARIANTS = {
  PENDING: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'error',
  SUPERSEDED: 'neutral',
};

/** CUSTOMER/PROFESSIONAL author-role badge — not a status per se, but reuses
 * the same badge component for consistent visual weight in the chat-style
 * negotiation thread; CUSTOMER info-toned, PROFESSIONAL success-toned, a
 * simple fixed choice so a reader can tell the two roles apart at a glance. */
function authorRoleVariant(role) {
  return role === 'CUSTOMER' ? 'info' : 'success';
}

/** "Details" tab — everything the (pre-redesign) single-pane popup already
 * showed, statuses now rendered via `buildStatusBadge` instead of plain
 * text, plus the new `negotiatedPrice` field right under `price`. */
function buildQuoteDetailTabContent(detail) {
  const wrapper = document.createElement('div');
  const customerFullName = fullNameOrDisplayName(
    detail.serviceRequest.customerProfile,
  );
  const professionalFullName = fullNameOrDisplayName(detail.professional);

  wrapper.appendChild(
    buildSubsection('Quote', [
      buildField('Price', priceFormatterValue(detail.price)),
      buildField('Precio negociado', priceFormatterValue(detail.negotiatedPrice)),
      buildField('Message', detail.message),
      buildBadgeField(
        'Status',
        buildStatusBadge(detail.status, QUOTE_STATUS_VARIANTS[detail.status]),
      ),
      buildField('Created at', formatDateTime(detail.createdAt)),
      buildField('Updated at', formatDateTime(detail.updatedAt)),
    ]),
  );

  wrapper.appendChild(
    buildSubsection('Service Request', [
      buildField('Category', detail.serviceRequest.category.name),
      buildField('Description', detail.serviceRequest.description),
      buildField('Status', detail.serviceRequest.status),
    ]),
  );

  wrapper.appendChild(
    buildSubsection('Customer', [
      buildField('Name', customerFullName),
      buildField('Email', detail.serviceRequest.customerProfile.email),
    ]),
  );

  wrapper.appendChild(
    buildSubsection('Professional', [
      buildField('Name', professionalFullName),
      buildField('Email', detail.professional.email),
    ]),
  );

  // Omitted entirely (no empty "Engagement" heading) when this Quote was
  // never accepted — `detail.engagement` is `null` in that case.
  if (detail.engagement) {
    wrapper.appendChild(
      buildSubsection('Engagement', [
        buildField('Status', detail.engagement.status),
        buildField('Created at', formatDateTime(detail.engagement.createdAt)),
      ]),
    );
  }

  return wrapper;
}

/** One `QuoteNegotiationMessage` — an author-role badge, the message text,
 * a timestamp, and (if this message carried one) a bordered card for its
 * linked `QuotePriceProposal`. */
function buildNegotiationMessage(message) {
  const wrapper = document.createElement('div');
  wrapper.className = 'gs-negotiation-message';

  const header = document.createElement('div');
  header.className = 'gs-negotiation-message-header';
  header.appendChild(
    buildStatusBadge(message.authorRole, authorRoleVariant(message.authorRole)),
  );
  const timestamp = document.createElement('span');
  timestamp.className = 'gs-negotiation-message-timestamp text-secondary';
  timestamp.textContent = formatDateTime(message.createdAt);
  header.appendChild(timestamp);
  wrapper.appendChild(header);

  const body = document.createElement('p');
  body.className = 'gs-negotiation-message-body mb-0';
  body.textContent = message.message;
  wrapper.appendChild(body);

  if (message.priceProposal) {
    const proposal = message.priceProposal;
    const card = document.createElement('div');
    card.className = 'gs-detail-specialization gs-negotiation-proposal';
    card.append(
      buildField('Precio propuesto', priceFormatterValue(proposal.proposedPrice)),
      buildBadgeField(
        'Estado',
        buildStatusBadge(
          proposal.status,
          PRICE_PROPOSAL_STATUS_VARIANTS[proposal.status],
        ),
      ),
    );
    wrapper.appendChild(card);
  }

  return wrapper;
}

/**
 * Fetches `adminQuoteNegotiationThread(quoteId)` and renders it into
 * `container` — called lazily by the "Negotiation" tab's `onActivate`
 * (see `openQuoteDetailModal`), only once per modal open, only when that
 * tab is actually clicked. Handles the two known error cases scoped to
 * THIS tab (never closes the whole modal / shows the page-wide error
 * banner): the negotiation module disabled, or the caller lacking
 * `Permission.QUOTE_NEGOTIATION_READ`.
 */
async function loadNegotiationThread(quoteId, container) {
  try {
    const body = await graphqlRequest(QUOTE_NEGOTIATION_THREAD_QUERY, {
      quoteId,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        detailDialog.close();
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      container.textContent = '';
      const message = document.createElement('p');
      message.className = 'text-secondary mb-0';
      message.textContent =
        code === 'QUOTE_NEGOTIATION_MODULE_DISABLED'
          ? 'The negotiation module is disabled.'
          : code === 'ADMIN_FORBIDDEN'
            ? "You don't have permission to view this quote's negotiation."
            : 'Could not load the negotiation thread. Please try again.';
      container.appendChild(message);
      return;
    }

    container.textContent = '';
    for (const message of body.data.adminQuoteNegotiationThread) {
      container.appendChild(buildNegotiationMessage(message));
    }
  } catch (error) {
    container.textContent = '';
    const message = document.createElement('p');
    message.className = 'text-secondary mb-0';
    message.textContent =
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.';
    container.appendChild(message);
  }
}

/** "Negotiation" tab — an immediate empty state when
 * `negotiationMessageCount === 0` (no fetch needed at all), otherwise a
 * "Loading…" placeholder that `loadNegotiationThread` replaces once the tab
 * is actually activated (see `onActivate` below). */
function buildNegotiationTabContent(detail) {
  const container = document.createElement('div');

  if (detail.negotiationMessageCount === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-secondary mb-0';
    empty.textContent = 'No negotiation messages.';
    container.appendChild(empty);
    return { container, needsFetch: false };
  }

  const loading = document.createElement('p');
  loading.className = 'text-secondary mb-0';
  loading.textContent = 'Loading…';
  container.appendChild(loading);
  return { container, needsFetch: true };
}

/** CUSTOMER/PROFESSIONAL sender-role badge for one `EngagementMessage` —
 * CUSTOMER info-toned, PROFESSIONAL success-toned, same fixed-color
 * convention `authorRoleVariant` already establishes for the Negotiation
 * tab's author-role badge. */
function senderRoleVariant(role) {
  return role === 'CUSTOMER' ? 'info' : 'success';
}

/** One `EngagementMessage` in the "Chat" tab — a sender-role badge, the
 * message text, and a timestamp. Simpler than `buildNegotiationMessage`:
 * `EngagementMessage` carries no `priceProposal`-equivalent field at all
 * (this thread structurally cannot touch Quote/Engagement state), so there
 * is no price-proposal card branch to render. Reuses the existing
 * `gs-negotiation-message*` CSS classes directly (see
 * `css/admin-theme.css`) rather than adding a sibling set — those classes
 * are already generic chat-bubble styling (padding/border/header/timestamp/
 * body), with no negotiation-specific rule baked in. */
function buildEngagementChatMessage(message) {
  const wrapper = document.createElement('div');
  wrapper.className = 'gs-negotiation-message';

  const header = document.createElement('div');
  header.className = 'gs-negotiation-message-header';
  header.appendChild(
    buildStatusBadge(message.senderRole, senderRoleVariant(message.senderRole)),
  );
  const timestamp = document.createElement('span');
  timestamp.className = 'gs-negotiation-message-timestamp text-secondary';
  timestamp.textContent = formatDateTime(message.createdAt);
  header.appendChild(timestamp);
  wrapper.appendChild(header);

  const body = document.createElement('p');
  body.className = 'gs-negotiation-message-body mb-0';
  body.textContent = message.content;
  wrapper.appendChild(body);

  return wrapper;
}

/**
 * Fetches `adminEngagementChatThread(engagementId)` and renders it into
 * `container` — called lazily by the "Chat" tab's `onActivate` (see
 * `openQuoteDetailModal`), only once per modal open, only when that tab is
 * actually clicked. There is no `negotiationMessageCount`-equivalent field
 * to skip an empty-thread fetch cheaply (a deliberate scope trim — adding
 * one just for this would mean a new field on `QUOTE_DETAIL_QUERY`/
 * `AdminQuotesResolver` for a single UI convenience), so this always
 * fetches on first activation and renders an empty-state paragraph if the
 * returned array is empty. Handles the known error cases scoped to THIS tab
 * (never closes the whole modal / shows the page-wide error banner):
 * lacking `Permission.ENGAGEMENT_CHAT_READ`, or the target Engagement no
 * longer existing (`ADMIN_ENGAGEMENT_NOT_FOUND` — practically unreachable
 * here, since `engagementId` comes straight from this same `quoteDetail`
 * response, but handled explicitly rather than falling through to the
 * generic message). `ENGAGEMENT_CHAT_MODULE_DISABLED` is deliberately NOT
 * special-cased — `adminEngagementChatThread` is never gated by that guard
 * (see `AdminEngagementChatResolver`'s own header comment), so this code is
 * never expected to come back from this query.
 */
async function loadEngagementChatThread(engagementId, container) {
  try {
    const body = await graphqlRequest(ADMIN_ENGAGEMENT_CHAT_THREAD_QUERY, {
      engagementId,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        detailDialog.close();
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      container.textContent = '';
      const message = document.createElement('p');
      message.className = 'text-secondary mb-0';
      message.textContent =
        code === 'ADMIN_FORBIDDEN'
          ? "You don't have permission to view this engagement's conversation."
          : code === 'ADMIN_ENGAGEMENT_NOT_FOUND'
            ? 'This engagement no longer exists.'
            : 'Could not load the coordination chat. Please try again.';
      container.appendChild(message);
      return;
    }

    container.textContent = '';
    const messages = body.data.adminEngagementChatThread;
    if (messages.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-secondary mb-0';
      empty.textContent = 'No coordination messages yet.';
      container.appendChild(empty);
      return;
    }
    for (const message of messages) {
      container.appendChild(buildEngagementChatMessage(message));
    }
  } catch (error) {
    container.textContent = '';
    const message = document.createElement('p');
    message.className = 'text-secondary mb-0';
    message.textContent =
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.';
    container.appendChild(message);
  }
}

async function openQuoteDetailModal(rowData) {
  detailContentEl.textContent = '';
  showDetailError('');
  detailLoadingEl.hidden = false;
  detailDialog.showModal();

  try {
    const body = await graphqlRequest(QUOTE_DETAIL_QUERY, { id: rowData.id });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        detailDialog.close();
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showDetailError(
        code === 'ADMIN_QUOTE_NOT_FOUND'
          ? 'This quote no longer exists.'
          : 'Could not load this quote. Please try again.',
      );
      return;
    }

    const detail = body.data.quoteDetail;
    const { container: negotiationContainer, needsFetch } =
      buildNegotiationTabContent(detail);
    let negotiationLoaded = false;

    const tabs = [
      {
        id: 'detail',
        label: 'Details',
        content: buildQuoteDetailTabContent(detail),
      },
      {
        id: 'negotiation',
        label: 'Negotiation',
        content: negotiationContainer,
        onActivate: () => {
          if (negotiationLoaded || !needsFetch) {
            return;
          }
          negotiationLoaded = true;
          void loadNegotiationThread(detail.id, negotiationContainer);
        },
      },
    ];

    // "Chat" tab (GOS-46 follow-up) — only meaningful once `detail.engagement`
    // exists (no Engagement -> no coordination chat possible); omitted from
    // `tabs` entirely otherwise, same `if` gate the "Engagement" subsection
    // in `buildQuoteDetailTabContent` already uses. Always lazy-fetches on
    // first activation (no cheap count field to skip an empty fetch) — see
    // `loadEngagementChatThread`'s own comment for why this is a deliberate
    // scope trim, not an oversight.
    if (detail.engagement) {
      const chatContainer = document.createElement('div');
      const chatLoading = document.createElement('p');
      chatLoading.className = 'text-secondary mb-0';
      chatLoading.textContent = 'Loading…';
      chatContainer.appendChild(chatLoading);
      let chatLoaded = false;

      tabs.push({
        id: 'engagement-chat',
        label: 'Chat',
        content: chatContainer,
        onActivate: () => {
          if (chatLoaded) {
            return;
          }
          chatLoaded = true;
          void loadEngagementChatThread(detail.engagement.id, chatContainer);
        },
      });
    }

    detailContentEl.appendChild(
      renderDetailTabs(tabs, {
        idPrefix: 'quotes-detail',
        ariaLabel: 'Quote detail sections',
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

export async function loadQuotes() {
  showError('');
  showSuccess('');

  try {
    const body = await graphqlRequest(QUOTES_QUERY, {
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
          ? 'You do not have permission to view quotes.'
          : 'Could not load quotes.',
      );
      return;
    }

    const items = body.data.quotes.items;

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
