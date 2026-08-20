// GOS-30/31/32 — sidebar section switcher, inside the dashboard view.
// Same plain `hidden`-attribute pattern as `js/view.js` (login<->dashboard),
// applied one level deeper: switching between the sidebar's sections
// (Configuración, Usuarios, Service Requests, Quotes, Categories,
// Administradores, Auditoría) within the single `#dashboard-view` element —
// the former "Credenciales" placeholder tab was removed (2026-08-20):
// encrypted third-party credential management already lives grouped under
// "Configuración" (js/settings.js), and no dedicated view for it was ever
// built. Still no router library,
// still no navigation — every `[data-nav-target]` link's default click
// behavior is prevented and the target `.gs-section` is shown/hidden via
// its `hidden` attribute, exactly like the login/dashboard toggle.
const navLinks = Array.from(document.querySelectorAll('[data-nav-target]'));
const sections = new Map();

for (const link of navLinks) {
  const targetId = link.dataset.navTarget;
  const sectionEl = document.getElementById(targetId);
  if (sectionEl) {
    sections.set(targetId, sectionEl);
  }
}

let onShowCallbacks = {};

function setActiveLink(activeTargetId) {
  for (const link of navLinks) {
    const navItem = link.closest('.nav-item');
    const isActive = link.dataset.navTarget === activeTargetId;

    if (isActive) {
      link.setAttribute('aria-current', 'page');
      navItem?.classList.add('active');
    } else {
      link.removeAttribute('aria-current');
      navItem?.classList.remove('active');
    }
  }
}

/**
 * Shows the section whose id is `targetId` (and hides every other
 * registered section), updates the sidebar's active-item styling, and
 * runs that section's registered `onShow` callback, if any — e.g.
 * Configuración re-fetches its data on every show, while Usuarios (mock
 * data, rendered statically in the HTML) and the placeholder sections have
 * no callback at all.
 */
export function showSection(targetId) {
  if (!sections.has(targetId)) {
    return;
  }

  for (const [id, el] of sections) {
    el.hidden = id !== targetId;
  }

  setActiveLink(targetId);

  const callback = onShowCallbacks[targetId];
  if (typeof callback === 'function') {
    callback();
  }
}

/**
 * Wires every `[data-nav-target]` sidebar link to `showSection`.
 * `callbacks` maps a section id to a function to run each time that
 * section is shown (see `showSection`).
 */
export function initNav(callbacks = {}) {
  onShowCallbacks = callbacks;

  for (const link of navLinks) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      showSection(link.dataset.navTarget);
    });
  }
}
