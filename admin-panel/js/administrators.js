// Administrators-tab follow-up (2026-08-20) — owns the "Roles"/"Admin
// Users" sub-tab switch inside `#administradores-section`, built with the
// SAME hand-rolled ARIA-tabs pattern `settings.js`'s `renderRootTabs`/
// `userAccounts.js`'s `renderDetailTabs` already establish (a
// `role="tablist"` of `role="tab"` buttons, Left/Right/Home/End keyboard
// navigation, roving `tabIndex`) — deliberately NOT the static
// `<nav class="gs-subtabs">` markup already present elsewhere in this
// document (confirmed dead, unconnected to any JS in this panel). Each
// sub-tab's own module (`adminRoles.js`/`adminUsers.js`) owns its content —
// this file only owns the tablist/panel-visibility switch and re-fetches
// the active panel's data every time it's shown, same "fetch fresh data on
// every section show" convention `js/nav.js` already establishes one level
// up.
import { loadAdminRoles } from './adminRoles.js';
import { loadAdminUsers } from './adminUsers.js';

const tablistEl = document.getElementById('administradores-tablist');
const rolesPanel = document.getElementById('administradores-roles-panel');
const usersPanel = document.getElementById('administradores-users-panel');

const TABS = [
  { id: 'roles', label: 'Roles', panel: rolesPanel, load: loadAdminRoles },
  { id: 'users', label: 'Admin Users', panel: usersPanel, load: loadAdminUsers },
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
    tabButton.id = `administradores-tab-${tab.id}`;
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

/** `js/nav.js`'s registered `onShow` callback for `administradores-section`
 * — builds the tablist once, then (on this and every subsequent show)
 * re-fetches whichever sub-tab is currently selected. */
export function loadAdministratorsSection() {
  if (!built) {
    buildTablist();
    built = true;
  }
  const selectedIndex = tabButtons.findIndex((button) =>
    button.classList.contains('active'),
  );
  void TABS[selectedIndex === -1 ? 0 : selectedIndex].load();
}
