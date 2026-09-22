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
// 2026-09-18 follow-up (human-requested, "money matters a lot from here
// on") — cash was generalized into `PaymentAttempt` together with every
// other method (see that model's own schema comment), and Receipts now
// shows, per job: **Method** (who collected — Cash / Mercado Pago), **Type**
// (how — Cash / Credit card / Debit card / Account money), and **Payment
// Details** (brand + last 4 + fee/net for a digital payment, or the two
// confirmation dates for cash) — all sourced from the summary's own
// `paymentAttempt`, no second query. Also added: each row's Professional now
// carries their CURRENT running `balance` (net digital credits minus cash
// commission debt owed — can be negative), computed fresh by the backend on
// every read (never cached/recomputed client-side, never a stored running
// total — see `LedgerRepository.sumProfessionalBalance`'s own comment for
// why a materialized column was rejected: a concurrency hazard across
// different Engagements for the same Professional). GoService's own current
// balance (`adminPlatformBalance`) is shown once, above both grids.
//
// "Payment Attempts" (renamed from "Pending Cash Confirmations", same day)
// — every `PaymentAttempt` not yet settled (`adminPaymentAttempts`,
// `Permission.CASH_PAYMENTS_READ`, `filter: { onlyPending: true }` by
// default — PENDING or REJECTED, whatever the method) — visibility a
// payment SUMMARY structurally cannot provide, since Receipts only reflects
// a SETTLED (APPROVED) payment with ledger entries. Used to be cash-only;
// now shows a rejected card charge or a half-confirmed cash payment side by
// side. A toolbar checkbox lets an admin turn the `onlyPending` filter off
// to see every attempt ever created, settled ones included.
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
        paymentAttempt {
          type
          status
          rejectionReason
          cardBrand
          cardLastFour
          providerFeeAmount
          netReceivedAmount
          customerConfirmedAt
          professionalConfirmedAt
        }
        customer { id userId email firstName lastName }
        professional { id userId email firstName lastName displayName balance }
        entries { id receiptNumber type amount currency commissionPercentApplied createdAt }
      }
    }
  }
`;

const ADMIN_PLATFORM_BALANCE_QUERY = `
  query AdminPlatformBalance {
    adminPlatformBalance
  }
`;

const ADMIN_PAYMENT_ATTEMPTS_QUERY = `
  query AdminPaymentAttempts($filter: AdminPaymentAttemptsFilterInput, $limit: Int, $offset: Int) {
    adminPaymentAttempts(filter: $filter, limit: $limit, offset: $offset) {
      totalCount
      limit
      offset
      items {
        id
        engagementId
        method
        type
        status
        rejectionReason
        cardBrand
        cardLastFour
        customerConfirmedAt
        professionalConfirmedAt
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

// Mirrors `PaymentAttemptType` — HOW a job was paid (PaymentMethod says WHO
// collected). Hardcoded here deliberately, same trade-off as
// `EVENT_TYPE_LABEL`.
const PAYMENT_TYPE_LABEL = {
  CASH: 'Cash',
  CREDIT_CARD: 'Credit card',
  DEBIT_CARD: 'Debit card',
  ACCOUNT_MONEY: 'Account money',
};

function paymentTypeFormatter(cell) {
  const attempt = cell.getRow().getData().paymentAttempt;
  return attempt?.type ? (PAYMENT_TYPE_LABEL[attempt.type] ?? attempt.type) : '—';
}

/**
 * "Payment Details" column (Receipts) — the human-facing trace of HOW a job
 * was actually paid, sourced from the summary's own `paymentAttempt` (the
 * one PaymentAttempt that was ever approved for this Engagement — see
 * `PaymentAttemptRepository.findApprovedByEngagementId`'s own comment).
 * `null` for a job never paid (e.g. cancelled before any payment) — shown
 * as "—". A card shows brand/last 4 and what GoService netted after the
 * provider's fee; cash shows the two confirmation dates.
 */
/** Pure — takes the summary's own `paymentAttempt` (may be `null`) plus the
 * currency to format amounts in. Shared by the Receipts grid column and the
 * detail popup, so the two can never drift. */
function formatPaymentDetails(attempt, currency) {
  if (!attempt) return '—';

  if (attempt.type === 'CASH') {
    const customer = attempt.customerConfirmedAt
      ? new Date(attempt.customerConfirmedAt).toLocaleDateString()
      : '—';
    const professional = attempt.professionalConfirmedAt
      ? new Date(attempt.professionalConfirmedAt).toLocaleDateString()
      : '—';
    return `Customer confirmed ${customer} · Professional confirmed ${professional}`;
  }

  const parts = [];
  if (attempt.cardBrand) {
    const brand = attempt.cardBrand.charAt(0).toUpperCase() + attempt.cardBrand.slice(1);
    parts.push(`${brand} •••• ${attempt.cardLastFour ?? '????'}`);
  }
  if (attempt.netReceivedAmount != null) {
    parts.push(`net ${formatMoney(attempt.netReceivedAmount, currency)}`);
  }
  if (attempt.providerFeeAmount != null) {
    parts.push(`fee ${formatMoney(attempt.providerFeeAmount, currency)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function paymentDetailsFormatter(cell) {
  const rowData = cell.getRow().getData();
  return formatPaymentDetails(rowData.paymentAttempt, rowData.currency);
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
    title: 'Type',
    formatter: paymentTypeFormatter,
    headerFilter: false,
    minWidth: 120,
  },
  {
    title: 'Payment Details',
    formatter: paymentDetailsFormatter,
    headerFilter: false,
    minWidth: 240,
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

// Mirrors `PaymentAttemptStatus`. Hardcoded, same trade-off as
// `EVENT_TYPE_LABEL`.
const ATTEMPT_STATUS_BADGE_VARIANT = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
};

function attemptStatusFormatter(cell) {
  const value = cell.getValue();
  const wrapper = document.createElement('div');
  wrapper.append(buildStatusBadge(value, ATTEMPT_STATUS_BADGE_VARIANT[value] ?? 'neutral'));
  return wrapper;
}

function attemptMethodFormatter(cell) {
  return cell.getValue() ?? '—';
}

function attemptTypeFormatter(cell) {
  const value = cell.getValue();
  return value ? (PAYMENT_TYPE_LABEL[value] ?? value) : '—';
}

/** Every method's own "how it was actually paid" trace, minus the amounts
 * Receipts already shows (a not-yet-settled attempt has no ledger entries to
 * pull those from) — card brand/last 4 for a digital rejection, or the two
 * confirmation dates for cash. */
function attemptDetailsFormatter(cell) {
  const row = cell.getRow().getData();
  if (row.method === 'CASH') {
    const customer = row.customerConfirmedAt
      ? new Date(row.customerConfirmedAt).toLocaleDateString()
      : '—';
    const professional = row.professionalConfirmedAt
      ? new Date(row.professionalConfirmedAt).toLocaleDateString()
      : '—';
    return `Customer confirmed ${customer} · Professional confirmed ${professional}`;
  }
  if (row.cardBrand) {
    const brand = row.cardBrand.charAt(0).toUpperCase() + row.cardBrand.slice(1);
    return `${brand} •••• ${row.cardLastFour ?? '????'}`;
  }
  return '—';
}

const PAYMENT_ATTEMPT_COLUMNS = [
  {
    title: 'Engagement',
    field: 'engagementId',
    formatter: idFormatter,
    headerFilter: 'input',
    tooltip: true,
    minWidth: 130,
  },
  {
    title: 'Method',
    field: 'method',
    formatter: attemptMethodFormatter,
    headerFilter: 'list',
    headerFilterParams: { values: ['', 'CASH', 'MERCADOPAGO'] },
    headerFilterFunc: '=',
    minWidth: 130,
  },
  {
    title: 'Type',
    field: 'type',
    formatter: attemptTypeFormatter,
    headerFilter: false,
    minWidth: 120,
  },
  {
    title: 'Status',
    field: 'status',
    formatter: attemptStatusFormatter,
    headerFilter: 'list',
    headerFilterParams: { values: ['', 'PENDING', 'APPROVED', 'REJECTED'] },
    headerFilterFunc: '=',
    minWidth: 120,
  },
  {
    title: 'Rejection Reason',
    field: 'rejectionReason',
    formatter: (cell) => cell.getValue() ?? '—',
    headerFilter: false,
    minWidth: 170,
  },
  {
    title: 'Details',
    formatter: attemptDetailsFormatter,
    headerFilter: false,
    minWidth: 260,
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
      'Type',
      rowData.paymentAttempt?.type
        ? (PAYMENT_TYPE_LABEL[rowData.paymentAttempt.type] ?? rowData.paymentAttempt.type)
        : '—',
    ),
  );
  sections.push(
    buildField(
      'Payment Details',
      formatPaymentDetails(rowData.paymentAttempt, rowData.currency),
    ),
  );
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
      "Professional's Current Balance",
      formatMoney(rowData.professional.balance, rowData.currency),
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

// ---- "Payment Attempts" panel (adminPaymentAttempts) ----

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

async function loadPaymentAttemptsPanel() {
  showCashError('');

  try {
    const body = await graphqlRequest(ADMIN_PAYMENT_ATTEMPTS_QUERY, {
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
          ? 'You do not have permission to view payment attempts.'
          : 'Could not load payment attempts.',
      );
      return;
    }

    const items = body.data.adminPaymentAttempts.items;

    if (cashTable) {
      await cashTable.setData(items);
    } else {
      cashTable = new Tabulator(cashGridEl, {
        columns: PAYMENT_ATTEMPT_COLUMNS,
        data: items,
        layout: 'fitDataStretch',
        movableColumns: true,
        persistence: { columns: true },
        // v2 (2026-09-18 generalization) — the underlying columns/fields
        // changed (method/type/status/rejectionReason replace the cash-only
        // commissionDebtRecorded), so a stale v1 persisted-column-visibility
        // state must not leak into this new grid shape.
        persistenceID: 'goservice-admin-payments-attempts-v2',
        placeholder: 'No payment attempts found.',
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

// ---- GoService's own current balance (adminPlatformBalance) ----

const platformBalanceEl = document.getElementById('payments-platform-balance');

async function loadPlatformBalance() {
  try {
    const body = await graphqlRequest(ADMIN_PLATFORM_BALANCE_QUERY, {});
    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      platformBalanceEl.textContent = '';
      return;
    }
    platformBalanceEl.textContent = `GoService balance: ${formatMoney(body.data.adminPlatformBalance, '')}`;
  } catch {
    // Non-critical header figure — a failure here must not block either grid.
    platformBalanceEl.textContent = '';
  }
}

// ---- Sub-tab switch (SAME hand-rolled tablist pattern as js/administrators.js) ----

const tablistEl = document.getElementById('payments-tablist');
const ledgerPanel = document.getElementById('payments-ledger-panel');
const cashPanel = document.getElementById('payments-cash-panel');

const TABS = [
  { id: 'ledger', label: 'Receipts', panel: ledgerPanel, load: loadLedgerPanel },
  { id: 'cash', label: 'Payment Attempts', panel: cashPanel, load: loadPaymentAttemptsPanel },
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
  void loadPaymentAttemptsPanel();
});

/** `js/nav.js`'s registered `onShow` callback for `payments-section` —
 * builds the tablist once, then (on this and every subsequent show)
 * re-fetches whichever sub-tab is currently selected, same "fetch fresh
 * data on every section show" convention `js/administrators.js` already
 * establishes for its own sub-tabs. The GoService balance header (above
 * both tabs) is refreshed on every show too, independent of which tab is
 * selected. */
export function loadPaymentsSection() {
  if (!built) {
    buildTablist();
    built = true;
  }
  void loadPlatformBalance();
  const selectedIndex = tabButtons.findIndex((button) =>
    button.classList.contains('active'),
  );
  void TABS[selectedIndex === -1 ? 0 : selectedIndex].load();
}
