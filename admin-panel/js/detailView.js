// Shared detail-popup building blocks (GOS-53 Quote Negotiation admin
// follow-up, 2026-08-21) — `buildField`/`buildSubsection` used to be
// byte-identical, hand-copied into `js/quotes.js`, `js/serviceRequests.js`,
// AND `js/userAccounts.js`; `renderDetailTabs` used to be
// `js/userAccounts.js`-only. All four are extracted here, unmodified in
// behavior (`renderDetailTabs` gained an `idPrefix`/`ariaLabel` option so
// the ids it generates stay unique per section — see that function's own
// comment), so every detail popup in this panel shares ONE implementation
// rather than three near-identical copies. `document.createElement`-only,
// same as every other file in this directory — never `innerHTML`.

/** One labeled field row (label above value, "—" for empty/falsy). */
export function buildField(label, value) {
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

/** A visually-separated sub-section within a tabpanel — a heading plus its
 * content nodes (`buildField` rows, cards, lists, etc.). */
export function buildSubsection(heading, contentNodes) {
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

/** Same label-above-value row `buildField` renders, but the value is a
 * badge node (see `buildStatusBadge` below) instead of plain text — used
 * wherever a Quote/ServiceRequest/QuotePriceProposal status used to render
 * via `buildField('Status', detail.status)`. */
export function buildBadgeField(label, badgeNode) {
  const wrapper = document.createElement('div');

  const labelEl = document.createElement('div');
  labelEl.className = 'gs-detail-field-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('div');
  valueEl.className = 'gs-detail-field-value';
  valueEl.appendChild(badgeNode);

  wrapper.append(labelEl, valueEl);
  return wrapper;
}

// Redesign follow-up (2026-08-21) — every status/urgency value across
// Quotes/Service Requests used to render as plain text; this replaces that
// with a small colored pill, reusing the `--gs-feedback-*` tokens
// `css/admin-theme.css` already defines but nothing consumed yet (only
// `categories.js`'s unrelated `badge bg-secondary-lt` child-count pill
// existed before this).
const VALID_BADGE_VARIANTS = ['success', 'warning', 'error', 'info', 'neutral'];

/**
 * A small colored status pill. `variant` is one of `success`/`warning`/
 * `error`/`info`/`neutral` — see `.gs-status-badge--*` in
 * `css/admin-theme.css` for the color each maps to. Falls back to
 * `neutral` for an unrecognized variant rather than throwing — a defensive
 * choice, since `variant` is usually the result of a status->variant
 * lookup table a caller maintains by hand.
 */
export function buildStatusBadge(text, variant) {
  const badge = document.createElement('span');
  const safeVariant = VALID_BADGE_VARIANTS.includes(variant)
    ? variant
    : 'neutral';
  badge.className = `gs-status-badge gs-status-badge--${safeVariant}`;
  badge.textContent = text;
  return badge;
}

/**
 * Builds a real, accessible tab strip (`role="tablist"`/`role="tab"`/
 * `role="tabpanel"`, Left/Right/Home/End keyboard navigation, roving
 * `tabIndex`) — the same ARIA APG tabs pattern `js/settings.js`'s
 * `renderRootTabs` originally established, first reused (in-file) by
 * `js/userAccounts.js`'s own `renderDetailTabs`, now shared here so
 * `js/quotes.js`/`js/serviceRequests.js` don't each hand-copy a third
 * near-identical implementation. `tabs` is `{ id, label, content }[]`; the
 * first tab is selected by default.
 *
 * `idPrefix` (default `'detail'`) namespaces the generated element ids
 * (`${idPrefix}-tab-${tab.id}` / `${idPrefix}-panel-${tab.id}`) — callers
 * MUST pass a value unique to their own dialog (e.g. `'quotes-detail'`) so
 * ids never collide with another section's detail dialog, even though only
 * one dialog is ever open at a time. `ariaLabel` sets the tablist's own
 * `aria-label` (default `'Detail sections'`).
 *
 * Each tab entry may also carry an `onActivate()` callback (GOS-53 Quote
 * Negotiation admin follow-up) — called every time that tab becomes the
 * selected one (click or keyboard nav), never for the first/default tab at
 * initial render (its `content` is already in the DOM synchronously). Powers
 * "fetch this tab's data lazily, only once, the first time it's actually
 * opened" (see `js/quotes.js`'s "Negociación" tab) — the callback itself is
 * responsible for not re-fetching on a later re-activation, `renderDetailTabs`
 * does not track that.
 */
export function renderDetailTabs(
  tabs,
  { idPrefix = 'detail', ariaLabel = 'Detail sections' } = {},
) {
  const wrapper = document.createDocumentFragment();
  const lastIndex = tabs.length - 1;

  const tablist = document.createElement('div');
  tablist.className = 'nav nav-underline gs-detail-tablist';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', ariaLabel);

  const panelsWrapper = document.createElement('div');

  const tabButtons = [];
  const panels = [];

  function selectTab(index) {
    tabButtons.forEach((button, buttonIndex) => {
      const isSelected = buttonIndex === index;
      button.setAttribute('aria-selected', String(isSelected));
      button.classList.toggle('active', isSelected);
      button.tabIndex = isSelected ? 0 : -1;
      panels[buttonIndex].hidden = !isSelected;
    });
    if (typeof tabs[index].onActivate === 'function') {
      tabs[index].onActivate();
    }
  }

  tabs.forEach((tab, index) => {
    const isSelected = index === 0;
    const tabId = `${idPrefix}-tab-${tab.id}`;
    const panelId = `${idPrefix}-panel-${tab.id}`;

    const tabItem = document.createElement('div');
    tabItem.className = 'nav-item';

    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.id = tabId;
    tabButton.className = 'nav-link';
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-selected', String(isSelected));
    tabButton.setAttribute('aria-controls', panelId);
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
    tablist.appendChild(tabItem);
    tabButtons.push(tabButton);

    const panel = document.createElement('div');
    panel.id = panelId;
    panel.className = 'gs-detail-tabpanel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabId);
    panel.tabIndex = 0;
    panel.hidden = !isSelected;
    panel.appendChild(tab.content);

    panelsWrapper.appendChild(panel);
    panels.push(panel);
  });

  wrapper.append(tablist, panelsWrapper);
  return wrapper;
}
