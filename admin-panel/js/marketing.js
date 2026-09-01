// Marketing-tab follow-up (2026-08-25, human-requested) — owns the
// horizontal sub-tab switch inside `#marketing-section`. Deliberately the
// SAME hand-rolled ARIA-tabs pattern `administrators.js` already establishes
// (a `role="tablist"` of `role="tab"` buttons, Left/Right/Home/End keyboard
// navigation, roving `tabIndex`) — copy that file's structure exactly rather
// than inventing a second tablist implementation. Today there is only one
// sub-tab, "Email" (wraps the pre-existing `emailTemplates.js` section
// unchanged), but this shell exists specifically so a future channel (e.g.
// "Push Notifications") can be added as one more `TABS` entry with zero
// structural change here or in index.html's top-level nav — see this
// section's own comment in index.html for why "Marketing" was chosen as the
// broader top-level label instead of keeping "Email Templates" as its own
// top-level item.
import { loadEmailTemplates } from './emailTemplates.js';
import { loadEmailLayout } from './emailLayout.js';

const tablistEl = document.getElementById('marketing-tablist');
const emailPanel = document.getElementById('marketing-email-panel');

// Shared email header/footer follow-up (2026-08-25) — a small local wrapper,
// not `loadEmailTemplates` directly, so the new, single `EmailLayout` card
// (`emailLayout.js`) refreshes alongside the 3 template cards every time
// this tab is shown.
async function loadEmailTab() {
  await loadEmailLayout();
  await loadEmailTemplates();
}

const TABS = [
  { id: 'email', label: 'Email', panel: emailPanel, load: loadEmailTab },
  // Next channel goes here, e.g.:
  // { id: 'push', label: 'Push Notifications', panel: pushPanel, load: loadPushNotifications },
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
    tabButton.id = `marketing-tab-${tab.id}`;
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

/** `js/nav.js`'s registered `onShow` callback for `marketing-section` —
 * builds the tablist once, then (on this and every subsequent show)
 * re-fetches whichever sub-tab is currently selected. */
export function loadMarketingSection() {
  if (!built) {
    buildTablist();
    built = true;
  }
  const selectedIndex = tabButtons.findIndex((button) =>
    button.classList.contains('active'),
  );
  void TABS[selectedIndex === -1 ? 0 : selectedIndex].load();
}
