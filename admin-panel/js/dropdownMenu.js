// GOS-3x follow-up ("Columns" toolbar button + per-row "⋮" action menu,
// 2026-08-11) — a small, generic, dependency-free dropdown-menu helper
// shared by both new UI pieces in `js/userAccounts.js`. Same
// `document.createElement`-only convention as every other DOM-building
// function in this panel (never `innerHTML`).
//
// Deliberately NOT built on Tabulator's own `headerMenu`/popup mechanism
// (the thing this replaces for column visibility) — that mechanism is
// wired specifically to a column header's own popup-button trigger, with
// no supported public API for opening the identical popup from an
// arbitrary toolbar button instead. This module implements the same
// "one popup open at a time, closes on outside click or Escape, real
// focusable menu items" behavior from scratch, so it can be anchored to
// ANY trigger element — a toolbar button (Columns) or a per-row button
// (the "⋮" kebab).
//
// Only ONE menu is ever open at a time, module-wide (`activeMenu`/
// `activeTrigger`) — opening a second menu (a different trigger, or the
// SAME trigger clicked again to toggle it closed) always closes whatever
// was already open first.

let activeMenu = null;
let activeTrigger = null;

function focusableItems() {
  if (!activeMenu) return [];
  return Array.from(
    activeMenu.querySelectorAll(
      '[role="menuitem"], [role="menuitemcheckbox"]',
    ),
  );
}

function handleOutsideClick(event) {
  if (
    activeMenu &&
    !activeMenu.contains(event.target) &&
    event.target !== activeTrigger
  ) {
    closeDropdownMenu();
  }
}

function handleKeydown(event) {
  if (!activeMenu) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    const trigger = activeTrigger;
    closeDropdownMenu();
    trigger?.focus();
    return;
  }

  const items = focusableItems();
  if (items.length === 0) return;
  const currentIndex = items.indexOf(document.activeElement);

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    items[(currentIndex + 1 + items.length) % items.length].focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    items[(currentIndex - 1 + items.length) % items.length].focus();
  }
}

/**
 * Closes whatever menu is currently open, if any — safe to call when
 * nothing is open. Restores `aria-expanded="false"` on the trigger that
 * opened it.
 */
export function closeDropdownMenu() {
  if (!activeMenu) return;
  activeMenu.remove();
  document.removeEventListener('click', handleOutsideClick);
  document.removeEventListener('keydown', handleKeydown);
  activeTrigger?.setAttribute('aria-expanded', 'false');
  activeMenu = null;
  activeTrigger = null;
}

/**
 * Builds one real, focusable menu-item element (`role="menuitem"`,
 * `tabIndex=0`) wrapping `content` (any DOM node — plain text via a
 * `<span>`, or a richer element like a `<label>` with a checkbox for the
 * Columns menu). `onActivate(event)` runs on click OR Enter/Space.
 * Closes the menu automatically afterward UNLESS `keepOpen` is true (the
 * Columns menu's checkboxes use this, mirroring the same "keep the menu
 * open so an admin can toggle several columns in a row" behavior the
 * former Tabulator `headerMenu` already had). `variant` adds a styling
 * hook (`'warning'`/`'danger'`) — never a new color, see
 * `css/admin-theme.css`.
 */
export function createMenuItem(
  content,
  onActivate,
  { keepOpen = false, variant = 'default' } = {},
) {
  const item = document.createElement('div');
  item.setAttribute('role', 'menuitem');
  item.tabIndex = 0;
  item.className =
    variant === 'default'
      ? 'gs-dropdown-item'
      : `gs-dropdown-item gs-dropdown-item-${variant}`;
  item.appendChild(content);

  function activate(event) {
    onActivate(event);
    if (!keepOpen) {
      closeDropdownMenu();
    }
  }

  item.addEventListener('click', activate);
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(event);
    }
  });

  return item;
}

/**
 * Opens a dropdown menu anchored below `triggerEl` (a real, positioned
 * `role="menu"` container appended to `document.body`, right-aligned to
 * the trigger's right edge and clamped to stay within the viewport).
 * `items` is an array of elements already built via `createMenuItem`.
 * Clicking `triggerEl` again while its own menu is open toggles it closed
 * (never opens a duplicate). Moves focus to the first item on open, same
 * as this panel's existing bulk-confirm `<dialog>` convention of moving
 * focus into newly-shown interactive content.
 */
export function openDropdownMenu(triggerEl, items) {
  if (activeTrigger === triggerEl) {
    closeDropdownMenu();
    return;
  }
  closeDropdownMenu();

  const menu = document.createElement('div');
  menu.className = 'gs-dropdown-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    menu.appendChild(item);
  }
  document.body.appendChild(menu);

  const rect = triggerEl.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 4}px`;
  const left = Math.max(
    8,
    Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8),
  );
  menu.style.left = `${left}px`;

  activeMenu = menu;
  activeTrigger = triggerEl;
  triggerEl.setAttribute('aria-expanded', 'true');

  document.addEventListener('click', handleOutsideClick);
  document.addEventListener('keydown', handleKeydown);

  focusableItems()[0]?.focus();
}
