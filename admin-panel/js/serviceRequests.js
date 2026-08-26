// GOS-38 follow-up (2026-08-18) — "Service Requests" section: a real,
// functional, READ-ONLY data grid over `ServiceRequest` (`serviceRequests`/
// `serviceRequestDetail`, `/admin/graphql` only), mirroring
// `js/userAccounts.js`'s grid/detail-modal conventions (Tabulator, the same
// `graphqlRequest`/`handleAdminUnauthenticated`/`showError` plumbing,
// `document.createElement`-only DOM building). Simpler than that file in
// one deliberate way: no edit/delete/bulk actions exist here — a
// ServiceRequest's lifecycle (publish/cancel) stays customer-owned, so
// there is exactly one row action ("View"), not a kebab menu.
//
// Every row/detail carries the "relación de usuarios" explicitly: which
// Customer (name + email, linked back to their `User`) owns each request —
// see `customer` on both `SERVICE_REQUESTS_QUERY` and
// `SERVICE_REQUEST_DETAIL_QUERY` below.
//
// Column-visibility follow-up (same day) — an always-visible "Columns"
// toolbar button, IDENTICAL pattern to `js/userAccounts.js`'s own
// (`columnVisibilityHeaderMenu` + `js/dropdownMenu.js`'s generic popup):
// this grid was missing it even though it already had
// `persistence: { columns: true }`/`movableColumns: true` from day one —
// there was just no discoverable way to actually HIDE a column before now.
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

const SERVICE_REQUESTS_QUERY = `
  query ServiceRequests($limit: Int, $offset: Int) {
    serviceRequests(limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items {
        id
        description
        urgency
        indicativeBudgetMin
        indicativeBudgetMax
        status
        attachmentsCount
        createdAt
        category { id name }
        customer { id userId displayName email firstName lastName }
      }
    }
  }
`;

// "View" row action — fetched lazily, on demand, when the detail modal
// opens; never pre-loaded alongside the grid's own lightweight
// `SERVICE_REQUESTS_QUERY` above.
const SERVICE_REQUEST_DETAIL_QUERY = `
  query ServiceRequestDetail($id: ID!) {
    serviceRequestDetail(id: $id) {
      id
      description
      urgency
      indicativeBudgetMin
      indicativeBudgetMax
      status
      cancelledAt
      createdAt
      updatedAt
      category { id name }
      customer { id userId displayName email firstName lastName }
      attachments { id url createdAt }
      quotes {
        id
        price
        negotiatedPrice
        status
        negotiationMessageCount
        professional { displayName email }
        createdAt
      }
    }
  }
`;

// "Create Service Request" form (GOS-38 follow-up, 2026-08-18) — all three
// fetched/sent lazily, only while that dialog is open; never pre-loaded
// alongside the grid.
const CATEGORIES_QUERY = `
  query ServiceRequestCategories {
    serviceRequestCategories { id name }
  }
`;

const ELIGIBLE_CUSTOMERS_QUERY = `
  query EligibleServiceRequestCustomers($search: String) {
    eligibleServiceRequestCustomers(search: $search) {
      id
      userId
      displayName
      email
      firstName
      lastName
    }
  }
`;

const CREATE_SERVICE_REQUEST_MUTATION = `
  mutation CreateServiceRequestForCustomer($input: AdminCreateServiceRequestInput!) {
    createServiceRequestForCustomer(input: $input) {
      id
    }
  }
`;

// Same phase-1 scope boundary as `js/userAccounts.js`'s own FETCH_LIMIT —
// one bounded page (the server-enforced max, see
// `ListAdminServiceRequestsService`), Tabulator's own header filters do
// client-side filtering/sorting on it, including by the customer's
// name/email — that's how an admin finds "this customer's requests"
// without a dedicated server-side filter argument.
const FETCH_LIMIT = 200;

// Mirrors ServiceRequestUrgency/ServiceRequestStatus (prisma/schema.prisma).
// Hardcoded here deliberately — same trade-off `userAccounts.js`'s
// ACCOUNT_STATUS_VALUES already accepts (no build step/codegen, and
// introspection is disabled by default).
const URGENCY_VALUES = ['FLEXIBLE', 'THIS_WEEK', 'URGENT'];
const STATUS_VALUES = ['OPEN', 'CANCELLED'];

// Status -> badge-variant lookup tables (redesign follow-up, 2026-08-21) —
// mirrors `prisma/schema.prisma`'s `ServiceRequestStatus`/`QuoteStatus`
// enum values, same hardcoded-here trade-off `STATUS_VALUES` above already
// accepts. `ServiceRequestStatus` here only lists `OPEN`/`ENGAGED`/
// `CANCELLED` per this task's mapping — `ENGAGED` isn't in `STATUS_VALUES`
// above (that list only drives the grid's header-filter dropdown, unrelated
// to the badge lookup here) but IS a real, reachable status once a Quote is
// accepted, so it still needs a variant.
const SERVICE_REQUEST_STATUS_VARIANTS = {
  OPEN: 'info',
  ENGAGED: 'success',
  CANCELLED: 'error',
};

const QUOTE_STATUS_VARIANTS = {
  SENT: 'info',
  ACCEPTED: 'success',
  REJECTED: 'error',
  WITHDRAWN: 'neutral',
};

const gridEl = document.getElementById('service-requests-grid');
const errorEl = document.getElementById('service-requests-error');
const successEl = document.getElementById('service-requests-success');
const columnsButton = document.getElementById('service-requests-columns-button');
const detailDialog = document.getElementById('service-requests-detail-dialog');
const detailCloseButton = document.getElementById(
  'service-requests-detail-close',
);
const detailErrorEl = document.getElementById('service-requests-detail-error');
const detailLoadingEl = document.getElementById(
  'service-requests-detail-loading',
);
const detailContentEl = document.getElementById(
  'service-requests-detail-content',
);

// "Create Service Request" dialog elements (GOS-38 follow-up, 2026-08-18).
const createButton = document.getElementById('service-requests-create-button');
const createDialog = document.getElementById('service-requests-create-dialog');
const createCloseButton = document.getElementById(
  'service-requests-create-close',
);
const createCancelButton = document.getElementById(
  'service-requests-create-cancel',
);
const createForm = document.getElementById('service-requests-create-form');
const createErrorEl = document.getElementById('service-requests-create-error');
const createSubmitButton = document.getElementById(
  'service-requests-create-submit',
);
const customerSearchInput = document.getElementById(
  'service-requests-create-customer-search',
);
const customerSelect = document.getElementById(
  'service-requests-create-customer-select',
);
const categorySelect = document.getElementById(
  'service-requests-create-category',
);
const descriptionInput = document.getElementById(
  'service-requests-create-description',
);
const urgencySelect = document.getElementById('service-requests-create-urgency');
const budgetMinInput = document.getElementById(
  'service-requests-create-budget-min',
);
const budgetMaxInput = document.getElementById(
  'service-requests-create-budget-max',
);

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
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

/** Same idea as `dateFormatter` but on a raw ISO string, outside the grid —
 * used by the "View" detail modal, mirrors `userAccounts.js`'s
 * `formatDateTime`. */
function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** "$100 – $500" / "$100+" / "up to $500" / "—" — never a bare `null`. */
function formatBudget(min, max) {
  if (min == null && max == null) return '—';
  if (min != null && max != null) return `$${min} – $${max}`;
  if (min != null) return `$${min}+`;
  return `up to $${max}`;
}

function budgetFormatter(cell) {
  const row = cell.getRow().getData();
  return formatBudget(row.indicativeBudgetMin, row.indicativeBudgetMax);
}

function customerNameFormatter(cell) {
  const customer = cell.getRow().getData().customer;
  const fullName = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(' ');
  return fullName || customer.displayName;
}

function customerEmailFormatter(cell) {
  return cell.getRow().getData().customer.email;
}

function categoryNameFormatter(cell) {
  return cell.getRow().getData().category.name;
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
    void openServiceRequestDetailModal(rowData);
  });

  wrapper.appendChild(button);
  return wrapper;
}

const COLUMNS = [
  { title: 'ID', field: 'id', visible: false, headerFilter: false },
  {
    title: 'Customer',
    field: 'customerName',
    formatter: customerNameFormatter,
    headerFilter: 'input',
    minWidth: 160,
  },
  {
    title: 'Email',
    field: 'customerEmail',
    formatter: customerEmailFormatter,
    headerFilter: 'input',
    minWidth: 200,
  },
  {
    title: 'Category',
    field: 'categoryName',
    formatter: categoryNameFormatter,
    headerFilter: 'input',
    minWidth: 130,
  },
  {
    title: 'Description',
    field: 'description',
    headerFilter: 'input',
    // Standing long-text-column convention (see `css/tabulator-theme.css`'s
    // own `.gs-truncate-cell` comment) — was `formatter: 'textarea'`
    // (multi-line wrap). `gs-truncate-cell` single-line-ellipsis-truncates,
    // `tooltip: true` reveals the full description on hover/focus.
    // Deliberately NO `maxWidth` — this codebase's own convention is
    // `minWidth` only on every column in every grid; a hard `maxWidth` here
    // fought Tabulator's own drag-to-resize (the column kept snapping back
    // to the cap instead of staying where the user dragged it to).
    minWidth: 200,
    cssClass: 'gs-truncate-cell',
    tooltip: true,
  },
  {
    title: 'Urgency',
    field: 'urgency',
    headerFilter: 'list',
    headerFilterParams: { values: ['', ...URGENCY_VALUES] },
    headerFilterFunc: '=',
    minWidth: 110,
  },
  {
    title: 'Budget',
    field: 'budget',
    formatter: budgetFormatter,
    headerFilter: false,
    headerSort: false,
    minWidth: 130,
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
    title: 'Attachments',
    field: 'attachmentsCount',
    hozAlign: 'center',
    headerFilter: false,
    minWidth: 100,
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
 * `js/userAccounts.js`'s own `columnVisibilityHeaderMenu` (see that
 * function's own comment for the full rationale: plain `<input
 * type="checkbox">` elements, never an icon-font toggle; `keepOpen` on
 * every item so an admin can toggle several columns without re-opening the
 * menu). Must be called with `this` bound to the Tabulator table instance
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
    return; // Nothing to toggle yet — before the first loadServiceRequests() resolves.
  }
  const menuEntries = columnVisibilityMenu.call(table);
  const items = menuEntries.map((entry) =>
    createMenuItem(entry.label, entry.action, { keepOpen: true }),
  );
  openDropdownMenu(columnsButton, items);
});

/**
 * Same "create once, reuse across section show/hide, .setData() on
 * reloads" convention as `js/userAccounts.js`'s own `buildTable` — see
 * that function's own comment for why `data: initialData` is passed
 * directly into the constructor rather than an empty table followed by an
 * immediate `.setData()` call.
 */
function buildTable(initialData) {
  table = new Tabulator(gridEl, {
    columns: COLUMNS,
    data: initialData,
    layout: 'fitDataStretch',
    movableColumns: true,
    persistence: { columns: true },
    persistenceID: 'goservice-admin-service-requests-v1',
    placeholder: 'No service requests found.',
  });
}

// ---------------------------------------------------------------------
// "View" row-detail modal — fetches `serviceRequestDetail(id)` on demand.
// Built entirely via `document.createElement`, never `innerHTML` — same
// convention as `js/userAccounts.js`.
// ---------------------------------------------------------------------

function showDetailError(message) {
  detailErrorEl.textContent = message;
  detailErrorEl.hidden = message === '';
}

// Urgency -> badge-variant lookup (redesign follow-up, 2026-08-21) — this
// task's own mapping instructions only spelled out `ServiceRequestStatus`/
// `QuoteStatus`/`QuotePriceProposalStatus`, not `ServiceRequestUrgency`; this
// is a judgment call worth a human sanity-check, same
// low/medium/high-urgency-toned reasoning `FLEXIBLE`/`THIS_WEEK`/`URGENT`'s
// own names already suggest.
const URGENCY_VARIANTS = {
  FLEXIBLE: 'neutral',
  THIS_WEEK: 'warning',
  URGENT: 'error',
};

/** Attachments render as real links (opening `LocalDevStorageAdapter`'s
 * `GET /uploads/:key` URL in a new tab) — never an `<img>` assumption,
 * since a PDF is an equally valid attachment content type. */
function buildAttachmentsSection(attachments) {
  if (!attachments || attachments.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-secondary mb-0';
    empty.textContent = 'No attachments.';
    return buildSubsection('Attachments', [empty]);
  }

  const list = document.createElement('ul');
  list.className = 'gs-attachment-list';
  for (const attachment of attachments) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = attachment.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = attachment.url;
    li.appendChild(link);
    list.appendChild(li);
  }
  return buildSubsection('Attachments', [list]);
}

function priceFormatterValue(value) {
  return value == null ? '—' : `$${value}`;
}

/** "Detalle" tab — the existing Customer/Request/Attachments subsections,
 * status/urgency now rendered via `buildStatusBadge` instead of plain
 * text. */
function buildServiceRequestDetailTabContent(detail) {
  const wrapper = document.createElement('div');
  const customerFullName =
    [detail.customer.firstName, detail.customer.lastName]
      .filter(Boolean)
      .join(' ') || detail.customer.displayName;

  wrapper.appendChild(
    buildSubsection('Customer', [
      buildField('Name', customerFullName),
      buildField('Email', detail.customer.email),
    ]),
  );

  wrapper.appendChild(
    buildSubsection('Request', [
      buildField('Category', detail.category.name),
      buildField('Description', detail.description),
      buildBadgeField(
        'Urgency',
        buildStatusBadge(detail.urgency, URGENCY_VARIANTS[detail.urgency]),
      ),
      buildField(
        'Indicative budget',
        formatBudget(detail.indicativeBudgetMin, detail.indicativeBudgetMax),
      ),
      buildBadgeField(
        'Status',
        buildStatusBadge(
          detail.status,
          SERVICE_REQUEST_STATUS_VARIANTS[detail.status],
        ),
      ),
      buildField('Created at', formatDateTime(detail.createdAt)),
      buildField('Updated at', formatDateTime(detail.updatedAt)),
      buildField('Cancelled at', formatDateTime(detail.cancelledAt)),
    ]),
  );

  wrapper.appendChild(buildAttachmentsSection(detail.attachments));

  return wrapper;
}

/** One row in the "Cotizaciones" tab's quote list — professional name,
 * price, negotiatedPrice (if set), a status badge, and (when this Quote has
 * negotiation activity) a small visible count indicator. Read-only — no
 * cross-navigation into `js/quotes.js`'s own detail popup (see this
 * module's own header comment / the delivery report for why that
 * nice-to-have was left out). */
function buildQuoteRow(quote) {
  const row = document.createElement('div');
  row.className = 'gs-quote-row';

  const main = document.createElement('div');
  main.className = 'gs-quote-row-main';
  main.append(
    buildField('Professional', quote.professional.displayName),
    buildField('Email', quote.professional.email),
    buildField('Price', priceFormatterValue(quote.price)),
    buildField('Precio negociado', priceFormatterValue(quote.negotiatedPrice)),
  );
  row.appendChild(main);

  row.appendChild(
    buildBadgeField(
      'Status',
      buildStatusBadge(quote.status, QUOTE_STATUS_VARIANTS[quote.status]),
    ),
  );

  if (quote.negotiationMessageCount > 0) {
    const indicator = document.createElement('div');
    indicator.className = 'gs-quote-row-negotiation-indicator';
    indicator.textContent = `💬 ${quote.negotiationMessageCount}`;
    row.appendChild(indicator);
  }

  return row;
}

/** "Cotizaciones" tab — every Quote submitted against this ServiceRequest
 * (already fetched eagerly, alongside the rest of `serviceRequestDetail` —
 * unlike Quotes' own "Negociación" tab, there is no separate
 * permission-gated query behind this list, so no lazy `onActivate` fetch is
 * needed here). Empty state if none exist yet. */
function buildQuotesTabContent(quotes) {
  const wrapper = document.createElement('div');

  if (!quotes || quotes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-secondary mb-0';
    empty.textContent = 'No quotes yet.';
    wrapper.appendChild(empty);
    return wrapper;
  }

  for (const quote of quotes) {
    wrapper.appendChild(buildQuoteRow(quote));
  }

  return wrapper;
}

async function openServiceRequestDetailModal(rowData) {
  detailContentEl.textContent = '';
  showDetailError('');
  detailLoadingEl.hidden = false;
  detailDialog.showModal();

  try {
    const body = await graphqlRequest(SERVICE_REQUEST_DETAIL_QUERY, {
      id: rowData.id,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        detailDialog.close();
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showDetailError(
        code === 'ADMIN_SERVICE_REQUEST_NOT_FOUND'
          ? 'This service request no longer exists.'
          : 'Could not load this service request. Please try again.',
      );
      return;
    }

    const detail = body.data.serviceRequestDetail;
    const tabs = [
      {
        id: 'detail',
        label: 'Detalle',
        content: buildServiceRequestDetailTabContent(detail),
      },
      {
        id: 'quotes',
        label: 'Cotizaciones',
        content: buildQuotesTabContent(detail.quotes),
      },
    ];

    detailContentEl.appendChild(
      renderDetailTabs(tabs, {
        idPrefix: 'service-requests-detail',
        ariaLabel: 'Service request detail sections',
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

// ---------------------------------------------------------------------
// "Create Service Request" dialog (GOS-38 follow-up, 2026-08-18) — an
// admin creates a ServiceRequest on behalf of a Customer. The customer
// picker only ever lists APPROVED accounts
// (`eligibleServiceRequestCustomers`), but `createServiceRequestForCustomer`
// itself re-validates that server-side regardless — this dialog is a
// convenience, not the enforcement.
// ---------------------------------------------------------------------

function showCreateError(message) {
  createErrorEl.textContent = message;
  createErrorEl.hidden = message === '';
}

/** Simple trailing-edge debounce — no library, matches this panel's
 * "no build step, hand-roll small utilities" convention. */
function debounce(fn, delayMs) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delayMs);
  };
}

function customerOptionLabel(customer) {
  const fullName = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(' ');
  return `${fullName || customer.displayName} — ${customer.email}`;
}

async function populateCategoryOptions() {
  categorySelect.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Loading…';
  placeholder.disabled = true;
  placeholder.selected = true;
  categorySelect.appendChild(placeholder);

  try {
    const body = await graphqlRequest(CATEGORIES_QUERY, {});
    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        createDialog.close();
        return;
      }
      showCreateError('Could not load categories. Please try again.');
      return;
    }

    categorySelect.textContent = '';
    for (const category of body.data.serviceRequestCategories) {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      categorySelect.appendChild(option);
    }
  } catch (error) {
    showCreateError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong loading categories.',
    );
  }
}

async function populateCustomerOptions(search) {
  try {
    const body = await graphqlRequest(ELIGIBLE_CUSTOMERS_QUERY, {
      search: search || undefined,
    });
    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        createDialog.close();
        return;
      }
      showCreateError('Could not load eligible customers. Please try again.');
      return;
    }

    customerSelect.textContent = '';
    const customers = body.data.eligibleServiceRequestCustomers;
    if (customers.length === 0) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'No approved customers found.';
      empty.disabled = true;
      customerSelect.appendChild(empty);
      return;
    }
    for (const customer of customers) {
      const option = document.createElement('option');
      option.value = customer.userId;
      option.textContent = customerOptionLabel(customer);
      customerSelect.appendChild(option);
    }
  } catch (error) {
    showCreateError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong loading customers.',
    );
  }
}

const debouncedCustomerSearch = debounce((value) => {
  void populateCustomerOptions(value);
}, 300);

customerSearchInput.addEventListener('input', (event) => {
  debouncedCustomerSearch(event.target.value);
});

function resetCreateForm() {
  createForm.reset();
  customerSearchInput.value = '';
  customerSelect.textContent = '';
  categorySelect.textContent = '';
  showCreateError('');
}

createButton.addEventListener('click', () => {
  resetCreateForm();
  createDialog.showModal();
  void populateCategoryOptions();
  void populateCustomerOptions('');
});

createCloseButton.addEventListener('click', () => {
  createDialog.close();
});

createCancelButton.addEventListener('click', () => {
  createDialog.close();
});

/** `''`/blank -> `undefined` (field omitted), otherwise the parsed integer
 * — mirrors how `PublishServiceRequestInput.indicativeBudgetMin`/`Max` are
 * both genuinely optional on the backend. */
function parseOptionalInt(rawValue) {
  const trimmed = rawValue.trim();
  if (trimmed === '') {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

createForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitCreateServiceRequest();
});

async function submitCreateServiceRequest() {
  const userId = customerSelect.value;
  if (!userId) {
    showCreateError('Select a customer first.');
    return;
  }
  const category = categorySelect.value;
  if (!category) {
    showCreateError('Select a category first.');
    return;
  }

  showCreateError('');
  createSubmitButton.disabled = true;

  try {
    const body = await graphqlRequest(CREATE_SERVICE_REQUEST_MUTATION, {
      input: {
        userId,
        category,
        description: descriptionInput.value,
        urgency: urgencySelect.value,
        indicativeBudgetMin: parseOptionalInt(budgetMinInput.value),
        indicativeBudgetMax: parseOptionalInt(budgetMaxInput.value),
      },
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        createDialog.close();
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showCreateError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to create service requests.'
          : code === 'ACCOUNT_NOT_APPROVED'
            ? 'This customer\'s account is not APPROVED — it may have changed since the list was loaded. Refresh and try again.'
            : code === 'CUSTOMER_PROFILE_REQUIRED'
              ? 'This user has no CustomerProfile, so a service request cannot be created for them.'
              : code === 'CATEGORY_NOT_FOUND'
                ? 'The selected category no longer exists. Refresh and try again.'
                : code === 'INVALID_SERVICE_REQUEST_BUDGET_RANGE'
                  ? 'The minimum budget cannot be greater than the maximum.'
                  : code === 'USER_ACCOUNT_NOT_FOUND'
                    ? 'This user account no longer exists.'
                    : 'Could not create the service request. Please try again.',
      );
      return;
    }

    createDialog.close();
    showSuccess('Service request created.');
    await loadServiceRequests();
  } catch (error) {
    showCreateError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    createSubmitButton.disabled = false;
  }
}

export async function loadServiceRequests() {
  showError('');
  showSuccess('');

  try {
    const body = await graphqlRequest(SERVICE_REQUESTS_QUERY, {
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
          ? 'You do not have permission to view service requests.'
          : 'Could not load service requests.',
      );
      return;
    }

    const items = body.data.serviceRequests.items;

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
