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
      message
      status
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

function buildField(label, value) {
  const wrapper = document.createElement('div');

  const labelEl = document.createElement('div');
  labelEl.className = 'gs-detail-field-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('div');
  valueEl.className = 'gs-detail-field-value';
  valueEl.textContent = value || '—';

  wrapper.append(labelEl, valueEl);
  return wrapper;
}

function buildSubsection(heading, contentNodes) {
  const section = document.createElement('div');
  section.className = 'gs-detail-subsection';

  const headingEl = document.createElement('h4');
  headingEl.className = 'gs-detail-subsection-heading';
  headingEl.textContent = heading;
  section.appendChild(headingEl);

  for (const node of contentNodes) {
    section.appendChild(node);
  }
  return section;
}

function buildDetailContent(detail) {
  const wrapper = document.createElement('div');
  const customerFullName = fullNameOrDisplayName(
    detail.serviceRequest.customerProfile,
  );
  const professionalFullName = fullNameOrDisplayName(detail.professional);

  wrapper.appendChild(
    buildSubsection('Quote', [
      buildField('Price', priceFormatterValue(detail.price)),
      buildField('Message', detail.message),
      buildField('Status', detail.status),
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

function priceFormatterValue(value) {
  return value == null ? '—' : `$${value}`;
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

    detailContentEl.appendChild(buildDetailContent(body.data.quoteDetail));
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
