// Payments admin follow-up (2026-09-14, human-requested) — a real,
// functional "Pagos" section: two sub-tabs, built with the SAME hand-rolled
// ARIA-tablist pattern `js/administrators.js`/`js/marketing.js` already
// establish (a `role="tablist"` of `role="tab"` buttons, Left/Right/Home/
// End keyboard navigation, roving `tabIndex`) — deliberately NOT the static
// `<nav class="gs-subtabs">` markup (confirmed dead elsewhere in this file).
//
// "Receipts" — REDESIGNED (same day, human-requested a clearer view):
// ONE ROW PER JOB (`adminEngagementPaymentSummaries`, `Permission.LEDGER_READ`),
// not per raw `LedgerEntry` — real Customer/Professional names, pre-computed
// totals (how much the Customer paid in total, GoService's own commission,
// what the Professional nets), which kind of event it was (cash payment /
// cancelled by Customer / cancelled by Professional), and the payment
// method. "View" opens a detail popup with the full breakdown plus every
// raw `LedgerEntry` row it was computed from — already embedded in the
// summary itself (`entries`), no second query needed. READ-ONLY throughout.
// All UI copy in this file is English, matching every other admin-panel
// section — human-requested, 2026-09-14 (a first pass at this section had
// Spanish labels, inconsistent with the rest of the panel).
//
// "Pending Cash Confirmations" — `CashPaymentConfirmation` rows where at
// most one party has confirmed so far (`adminCashPaymentConfirmations`,
// `Permission.CASH_PAYMENTS_READ`, `filter: { onlyPending: true }` by
// default) — visibility a payment SUMMARY structurally cannot provide, a
// `CASH_COMMISSION_DEBT` entry (and therefore a summary row) only ever
// exists once BOTH parties confirm. A toolbar checkbox lets an admin turn
// the `onlyPending` filter off to see every cash-payment confirmation ever
// created, fully confirmed ones included.
import { TabulatorFull as Tabulator } from '../vendor/tabulator/js/tabulator_esm.min.mjs';
import { graphqlRequest, GraphQLNetworkError } from './graphqlClient.js';
import { buildBadgeField, buildField, buildStatusBadge } from './detailView.js';
import { clearSession } from './session.js';
import { showLoginView } from './view.js';

const ADMIN_ENGAGEMENT_PAYMENT_SUMMARIES_QUERY = `
  query AdminEngagementPaymentSummaries($limit: Int, $offset: Int) {
    adminEngagementPaymentSummaries(limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items {
        engagementId
        eventType
        paymentMethod
        totalPaidByCustomer
        platformCommission
        professionalNetAmount
        currency
        professionalTotalPendingCashDebt
        occurredAt
        customer { id userId email firstName lastName }
        professional { id userId email firstName lastName displayName }
        entries { id receiptNumber type amount currency commissionPercentApplied createdAt }
      }
    }
  }
`;

const ADMIN_CASH_PAYMENT_CONFIRMATIONS_QUERY = `
  query AdminCashPaymentConfirmations($filter: AdminCashPaymentConfirmationsFilterInput, $limit: Int, $offset: Int) {
    adminCashPaymentConfirmations(filter: $filter, limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items {
        id
        engagementId
        customerConfirmedAt
        professionalConfirmedAt
        commissionDebtRecorded
        createdAt
      }
    }
  }
`;

// Same phase-1 scope boundary as every other grid's own FETCH_LIMIT — one
// bounded page (the server-enforced max on each of these two queries),
// Tabulator's own header filters do client-side filtering/sorting on it.
const FETCH_LIMIT = 200;

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

/** A raw UUID is too wide for a comfortable column — shown truncated, full
 * value always available via `tooltip: true` (same convention as every
 * long-text column in this panel, e.g. `js/reviews.js`'s own
 * `engagementIdFormatter`). */
function idFormatter(cell) {
  const value = cell.getValue();
  if (!value) return '—';
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

/**
 * Zero-pads a "comprobante" number to 11 digits (e.g. `7` -> `"00000000007"`)
 * — purely a display concern; the backend stores/returns a plain integer
 * (`LedgerEntry.receiptNumber`), never a pre-formatted string.
 */
function formatReceiptNumber(value) {
  return value == null ? '—' : String(value).padStart(11, '0');
}

function formatMoney(amount, currency) {
  return `${amount} ${currency ?? ''}`.trim();
}

function amountCellFormatter(cell) {
  const rowData = cell.getRow().getData();
  return formatMoney(cell.getValue(), rowData.currency);
}

// Mirrors `AdminEngagementPaymentEventType` (`prisma`-adjacent, GraphQL-only
// enum — see that file's own header comment for why it has no matching
// Prisma enum). Hardcoded here deliberately — same trade-off every other
// grid's own `*_VALUES`/`*_BADGE_VARIANT` lookup already accepts.
const EVENT_TYPE_LABEL = {
  CASH_PAYMENT: 'Cash',
  CUSTOMER_CANCELLATION: 'Cancelled by Customer',
  PROFESSIONAL_CANCELLATION: 'Cancelled by Professional',
  DIGITAL_PAYMENT: 'Digital Payment', // Reserved — no writer yet (GOS-79/80).
};
const EVENT_TYPE_BADGE_VARIANT = {
  CASH_PAYMENT: 'warning',
  CUSTOMER_CANCELLATION: 'error',
  PROFESSIONAL_CANCELLATION: 'neutral',
  DIGITAL_PAYMENT: 'success',
};

function eventTypeFormatter(cell) {
  const value = cell.getValue();
  const wrapper = document.createElement('div');
  wrapper.append(
    buildStatusBadge(
      EVENT_TYPE_LABEL[value] ?? value,
      EVENT_TYPE_BADGE_VARIANT[value] ?? 'neutral',
    ),
  );
  return wrapper;
}

function paymentMethodFormatter(cell) {
  const value = cell.getValue();
  return value ?? '—';
}

function booleanFormatter(cell) {
  const wrapper = document.createElement('div');
  wrapper.append(
    cell.getValue()
      ? buildStatusBadge('Yes', 'success')
      : buildStatusBadge('No', 'neutral'),
  );
  return wrapper;
}

function personFullName(person) {
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

function customerNameFormatter(cell) {
  return personFullName(cell.getRow().getData().customer);
}

function professionalNameFormatter(cell) {
  return personFullName(cell.getRow().getData().professional);
}

function paymentActionsFormatter(cell) {
  const rowData = cell.getRow().getData();
  const wrapper = document.createElement('div');
  wrapper.className = 'd-flex justify-content-center';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm btn-outline-secondary';
  button.textContent = 'View';
  button.addEventListener('click', () => openPaymentDetailModal(rowData));

  wrapper.appendChild(button);
  return wrapper;
}

const LEDGER_COLUMNS = [
  {
    title: 'Engagement',
    field: 'engagementId',
    formatter: idFormatter,
    headerFilter: 'input',
    tooltip: true,
    minWidth: 130,
  },
  {
    title: 'Event',
    field: 'eventType',
    formatter: eventTypeFormatter,
    headerFilter: 'list',
    headerFilterParams: { values: ['', ...Object.keys(EVENT_TYPE_LABEL)] },
    headerFilterFunc: '=',
    minWidth: 190,
  },
  {
    title: 'Payment Method',
    field: 'paymentMethod',
    formatter: paymentMethodFormatter,
    headerFilter: false,
    minWidth: 130,
  },
  {
    title: 'Customer',
    field: 'customerName',
    formatter: customerNameFormatter,
    headerFilter: 'input',
    minWidth: 160,
  },
  {
    title: 'Professional',
    field: 'professionalName',
    formatter: professionalNameFormatter,
    headerFilter: 'input',
    minWidth: 160,
  },
  {
    title: 'Total Paid by Customer',
    field: 'totalPaidByCustomer',
    formatter: amountCellFormatter,
    headerFilter: false,
    minWidth: 180,
  },
  {
    title: 'GoService Commission',
    field: 'platformCommission',
    formatter: amountCellFormatter,
    headerFilter: false,
    minWidth: 160,
  },
  {
    title: 'Professional Net',
    field: 'professionalNetAmount',
    formatter: amountCellFormatter,
    headerFilter: false,
    minWidth: 150,
  },
  {
    title: 'Date',
    field: 'occurredAt',
    formatter: dateFormatter,
    headerFilter: false,
    minWidth: 160,
  },
  {
    title: 'Actions',
    formatter: paymentActionsFormatter,
    headerFilter: false,
    headerSort: false,
    hozAlign: 'center',
    width: 90,
  },
];

const CASH_CONFIRMATION_COLUMNS = [
  {
    title: 'Engagement',
    field: 'engagementId',
    formatter: idFormatter,
    headerFilter: 'input',
    tooltip: true,
    minWidth: 130,
  },
  {
    title: 'Confirmed by Customer',
    field: 'customerConfirmedAt',
    formatter: dateFormatter,
    headerFilter: false,
    minWidth: 190,
  },
  {
    title: 'Confirmed by Professional',
    field: 'professionalConfirmedAt',
    formatter: dateFormatter,
    headerFilter: false,
    minWidth: 200,
  },
  {
    title: 'Commission Recorded',
    field: 'commissionDebtRecorded',
    formatter: booleanFormatter,
    headerFilter: false,
    minWidth: 160,
  },
  {
    title: 'Date',
    field: 'createdAt',
    formatter: dateFormatter,
    headerFilter: false,
    minWidth: 160,
  },
];

// ---- "Comprobantes" panel (adminEngagementPaymentSummaries) ----

const ledgerGridEl = document.getElementById('payments-ledger-grid');
const ledgerErrorEl = document.getElementById('payments-ledger-error');
let ledgerTable = null;

function showLedgerError(message) {
  ledgerErrorEl.textContent = message;
  ledgerErrorEl.hidden = message === '';
}

async function loadLedgerPanel() {
  showLedgerError('');

  try {
    const body = await graphqlRequest(
      ADMIN_ENGAGEMENT_PAYMENT_SUMMARIES_QUERY,
      { limit: FETCH_LIMIT, offset: 0 },
    );

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showLedgerError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to view payments.'
          : 'Could not load payments.',
      );
      return;
    }

    const items = body.data.adminEngagementPaymentSummaries.items;

    if (ledgerTable) {
      await ledgerTable.setData(items);
    } else {
      ledgerTable = new Tabulator(ledgerGridEl, {
        columns: LEDGER_COLUMNS,
        data: items,
        layout: 'fitDataStretch',
        movableColumns: true,
        persistence: { columns: true },
        // v2 (2026-09-14 redesign) — the underlying columns/fields changed
        // completely (per-job summary, not per-LedgerEntry-row), so a
        // stale v1 persisted-column-visibility state (referencing fields
        // like `type`/`amount`/`receiptNumber` that no longer exist as
        // columns here) must not leak into this new grid shape.
        persistenceID: 'goservice-admin-payments-ledger-v2',
        placeholder: 'No payment receipts found.',
      });
    }
  } catch (error) {
    showLedgerError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  }
}

// ---- Payment detail popup ----

const paymentDetailDialog = document.getElementById('payments-detail-dialog');
const paymentDetailCloseButton = document.getElementById(
  'payments-detail-close',
);
const paymentDetailContentEl = document.getElementById(
  'payments-detail-content',
);

paymentDetailCloseButton.addEventListener('click', () => {
  paymentDetailDialog.close();
});

function ledgerEntryTypeLabel(type) {
  return type; // Raw LedgerEntryType — an admin auditing the itemized
  // breakdown wants the exact enum value, not a friendlier paraphrase.
}

/**
 * Builds the itemized "raw LedgerEntry rows" list at the bottom of the
 * detail popup — every row this summary was computed from, exactly as
 * recorded (receipt #, type, amount) — an admin can always drop down to
 * the raw audit trail, never just the derived totals above it.
 */
function buildEntriesList(entries) {
  const list = document.createElement('div');
  list.className = 'table-responsive';

  const table = document.createElement('table');
  table.className = 'table table-sm mb-0';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Receipt #', 'Type', 'Amount', 'Date']) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const entry of entries) {
    const row = document.createElement('tr');

    const receiptCell = document.createElement('td');
    receiptCell.textContent = formatReceiptNumber(entry.receiptNumber);

    const typeCell = document.createElement('td');
    typeCell.textContent = ledgerEntryTypeLabel(entry.type);

    const amountCell = document.createElement('td');
    amountCell.textContent = formatMoney(entry.amount, entry.currency);

    const dateCell = document.createElement('td');
    dateCell.textContent = new Date(entry.createdAt).toLocaleString();

    row.append(receiptCell, typeCell, amountCell, dateCell);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  list.appendChild(table);
  return list;
}

/**
 * Renders the full breakdown for one payment summary — same
 * `buildField`/`buildBadgeField` building blocks every other detail popup
 * in this panel already uses (`js/quotes.js`/`js/serviceRequests.js`).
 * Synchronous: the summary row already carries everything needed
 * (including the raw `entries`), so no second network round trip.
 *
 * When `paymentMethod === 'CASH'` — the human-requested clarification —
 * shows an explicit callout: this job's commission was never separately
 * collected by GoService; it's added to the Professional's own running
 * `CASH_COMMISSION_DEBT` balance (`professionalTotalPendingCashDebt`,
 * the exact same figure `myPendingCashCommissionDebt` computes for that
 * Professional themselves), which they still owe.
 */
function openPaymentDetailModal(rowData) {
  paymentDetailContentEl.textContent = '';

  const sections = [];

  sections.push(
    buildBadgeField(
      'Event',
      buildStatusBadge(
        EVENT_TYPE_LABEL[rowData.eventType] ?? rowData.eventType,
        EVENT_TYPE_BADGE_VARIANT[rowData.eventType] ?? 'neutral',
      ),
    ),
  );
  sections.push(buildField('Engagement', rowData.engagementId));
  sections.push(buildField('Payment Method', rowData.paymentMethod ?? '—'));
  sections.push(
    buildField(
      'Customer',
      `${personFullName(rowData.customer)} (${rowData.customer.email})`,
    ),
  );
  sections.push(
    buildField(
      'Professional',
      `${personFullName(rowData.professional)} (${rowData.professional.email})`,
    ),
  );
  sections.push(
    buildField(
      'Total Paid by Customer',
      formatMoney(rowData.totalPaidByCustomer, rowData.currency),
    ),
  );
  sections.push(
    buildField(
      'GoService Commission',
      formatMoney(rowData.platformCommission, rowData.currency),
    ),
  );
  sections.push(
    buildField(
      'Professional Net',
      formatMoney(rowData.professionalNetAmount, rowData.currency),
    ),
  );
  sections.push(
    buildField('Date', new Date(rowData.occurredAt).toLocaleString()),
  );

  for (const section of sections) {
    paymentDetailContentEl.appendChild(section);
  }

  if (rowData.paymentMethod === 'CASH') {
    const callout = document.createElement('div');
    callout.className = 'alert alert-warning mt-3 mb-3';
    callout.textContent =
      `This job was paid in cash, hand to hand — GoService never collected ` +
      `anything directly. The ` +
      `${formatMoney(rowData.platformCommission, rowData.currency)} commission ` +
      `was NOT deducted from any payment: it was ADDED to the balance this ` +
      `Professional still owes the platform. This Professional's current total ` +
      `pending balance (across every cash job): ` +
      `${formatMoney(rowData.professionalTotalPendingCashDebt ?? 0, rowData.currency)}.`;
    paymentDetailContentEl.appendChild(callout);
  }

  const entriesHeading = document.createElement('h4');
  entriesHeading.className = 'gs-detail-subsection-heading mt-3';
  entriesHeading.textContent = 'Individual Ledger Entries (Audit Trail)';
  paymentDetailContentEl.appendChild(entriesHeading);
  paymentDetailContentEl.appendChild(buildEntriesList(rowData.entries));

  paymentDetailDialog.showModal();
}

// ---- "Efectivo pendiente" panel (adminCashPaymentConfirmations) ----

const cashGridEl = document.getElementById('payments-cash-grid');
const cashErrorEl = document.getElementById('payments-cash-error');
const cashOnlyPendingCheckbox = document.getElementById(
  'payments-cash-only-pending',
);
let cashTable = null;

function showCashError(message) {
  cashErrorEl.textContent = message;
  cashErrorEl.hidden = message === '';
}

async function loadCashPanel() {
  showCashError('');

  try {
    const body = await graphqlRequest(ADMIN_CASH_PAYMENT_CONFIRMATIONS_QUERY, {
      filter: { onlyPending: cashOnlyPendingCheckbox.checked },
      limit: FETCH_LIMIT,
      offset: 0,
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showCashError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to view cash payment confirmations.'
          : 'Could not load cash payment confirmations.',
      );
      return;
    }

    const items = body.data.adminCashPaymentConfirmations.items;

    if (cashTable) {
      await cashTable.setData(items);
    } else {
      cashTable = new Tabulator(cashGridEl, {
        columns: CASH_CONFIRMATION_COLUMNS,
        data: items,
        layout: 'fitDataStretch',
        movableColumns: true,
        persistence: { columns: true },
        persistenceID: 'goservice-admin-payments-cash-v1',
        placeholder: 'No cash payment confirmations found.',
      });
    }
  } catch (error) {
    showCashError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  }
}

// ---- Sub-tab switch (SAME hand-rolled tablist pattern as js/administrators.js) ----

const tablistEl = document.getElementById('payments-tablist');
const ledgerPanel = document.getElementById('payments-ledger-panel');
const cashPanel = document.getElementById('payments-cash-panel');

const TABS = [
  { id: 'ledger', label: 'Receipts', panel: ledgerPanel, load: loadLedgerPanel },
  { id: 'cash', label: 'Pending Cash Confirmations', panel: cashPanel, load: loadCashPanel },
];

let built = false;
const tabButtons = [];

function selectTab(index) {
  TABS.forEach((tab, i) => {
    const isSelected = i === index;
    tabButtons[i].setAttribute('aria-selected', String(isSelected));
    tabButtons[i].classList.toggle('active', isSelected);
    tabButtons[i].tabIndex = isSelected ? 0 : -1;
    tab.panel.hidden = !isSelected;
  });
  void TABS[index].load();
}

function buildTablist() {
  const lastIndex = TABS.length - 1;

  TABS.forEach((tab, index) => {
    const isSelected = index === 0;

    const tabItem = document.createElement('div');
    tabItem.className = 'nav-item';

    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.id = `payments-tab-${tab.id}`;
    tabButton.className = 'nav-link';
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-selected', String(isSelected));
    tabButton.setAttribute('aria-controls', tab.panel.id);
    tabButton.tabIndex = isSelected ? 0 : -1;
    tabButton.textContent = tab.label;
    if (isSelected) {
      tabButton.classList.add('active');
    }

    tabButton.addEventListener('click', () => selectTab(index));
    tabButton.addEventListener('keydown', (event) => {
      let nextIndex = null;
      if (event.key === 'ArrowRight') {
        nextIndex = index === lastIndex ? 0 : index + 1;
      } else if (event.key === 'ArrowLeft') {
        nextIndex = index === 0 ? lastIndex : index - 1;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = lastIndex;
      }
      if (nextIndex !== null) {
        event.preventDefault();
        selectTab(nextIndex);
        tabButtons[nextIndex].focus();
      }
    });

    tabItem.appendChild(tabButton);
    tablistEl.appendChild(tabItem);
    tabButtons.push(tabButton);
    tab.panel.setAttribute('aria-labelledby', tabButton.id);
  });
}

cashOnlyPendingCheckbox.addEventListener('change', () => {
  void loadCashPanel();
});

/** `js/nav.js`'s registered `onShow` callback for `payments-section` —
 * builds the tablist once, then (on this and every subsequent show)
 * re-fetches whichever sub-tab is currently selected, same "fetch fresh
 * data on every section show" convention `js/administrators.js` already
 * establishes for its own sub-tabs. */
export function loadPaymentsSection() {
  if (!built) {
    buildTablist();
    built = true;
  }
  const selectedIndex = tabButtons.findIndex((button) =>
    button.classList.contains('active'),
  );
  void TABS[selectedIndex === -1 ? 0 : selectedIndex].load();
}
