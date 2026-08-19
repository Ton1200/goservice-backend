// Category-tree follow-up (2026-08-18) — "Categories" section: full CRUD
// (create/rename/reorder/re-parent/delete) over the `Category` catalog,
// rendered as an actual expand/collapse TREE (not a Tabulator grid — this
// data is inherently hierarchical, and Tabulator has no tree module
// vendored in this panel) built entirely via `document.createElement`,
// never `innerHTML`, same convention as every other section in this panel.
// Same `graphqlRequest`/`handleAdminUnauthenticated`/`showError` plumbing
// as `js/serviceRequests.js`/`js/userAccounts.js`.
//
// Drag-and-drop follow-up (same day) — powered by vendored SortableJS
// (`../vendor/sortablejs/NOTICE.md`), a real nested-list drag-and-drop
// library rather than a hand-rolled one (explicit human decision — a
// first hand-rolled native-HTML5-DnD pass existed and worked, but was
// replaced for smoother reorder animation and more robust nested-list
// handling). ONE `Sortable` instance per VISIBLE children container (the
// root list + every currently-EXPANDED category's own children container,
// including empty ones — collapsed containers get none, see
// `attachSortableInstances`'s own comment), all sharing one `group` so
// items can be dragged between levels (= re-parenting) as well as
// reordered within one level. This is layered ENTIRELY on top of the
// existing `updateCategory` mutation (same one the ↑/↓ buttons and the
// edit dialog's "Parent category" select already use) — no new backend
// capability. `onMove` client-side-rejects any drop that would create a
// cycle (dropping a category onto itself or one of its own descendants),
// same rule `CATEGORY_PARENT_CYCLE` enforces server-side regardless. The
// ↑/↓ buttons and the edit dialog's parent picker are DELIBERATELY kept,
// not replaced — drag-and-drop is mouse/touch-only and has no accessible
// keyboard equivalent, so this panel always offers both. KNOWN LIMITATION:
// a COLLAPSED category can't be a drop target (nothing to visually target)
// — expand it first, or use the edit dialog's parent picker instead.
import { Sortable } from '../vendor/sortablejs/js/sortable.esm.min.mjs';
import { graphqlRequest, GraphQLNetworkError } from './graphqlClient.js';
import { clearSession } from './session.js';
import { showLoginView } from './view.js';

const CATEGORY_TREE_QUERY = `
  query AdminCategoryTree {
    adminCategoryTree {
      id name displayOrder parentId
      children {
        id name displayOrder parentId
        children {
          id name displayOrder parentId
          children {
            id name displayOrder parentId
            children { id name displayOrder parentId children { id } }
          }
        }
      }
    }
  }
`;

const CREATE_CATEGORY_MUTATION = `
  mutation CreateCategory($input: CreateCategoryInput!) {
    createCategory(input: $input) { id }
  }
`;

const UPDATE_CATEGORY_MUTATION = `
  mutation UpdateCategory($id: ID!, $input: UpdateCategoryInput!) {
    updateCategory(id: $id, input: $input) { id }
  }
`;

const DELETE_CATEGORY_MUTATION = `
  mutation DeleteCategory($id: ID!) {
    deleteCategory(id: $id) { success }
  }
`;

const treeContainer = document.getElementById('categories-tree');
const emptyStateEl = document.getElementById('categories-empty');
const errorEl = document.getElementById('categories-error');
const successEl = document.getElementById('categories-success');
const createRootButton = document.getElementById('categories-create-root-button');

const formDialog = document.getElementById('categories-form-dialog');
const formHeadingEl = document.getElementById('categories-form-heading');
const formCloseButton = document.getElementById('categories-form-close');
const formCancelButton = document.getElementById('categories-form-cancel');
const form = document.getElementById('categories-form');
const formErrorEl = document.getElementById('categories-form-error');
const formSubmitButton = document.getElementById('categories-form-submit');
const nameInput = document.getElementById('categories-form-name');
const parentSelect = document.getElementById('categories-form-parent');
const displayOrderInput = document.getElementById('categories-form-display-order');

// In-memory only (no localStorage) — resets to "everything expanded" on
// every reload, which is the right default for a catalog this small (see
// `Category`'s own "small by design" comment). Tracks COLLAPSED node ids,
// not expanded ones, so a freshly-created node (never added to this Set)
// starts expanded automatically.
const collapsedNodeIds = new Set();

// Set while the create/edit dialog is open — null means "creating a root
// (or, if createParentId is set, a child) Category"; a string means
// "editing this existing Category".
let editingCategoryId = null;
// Pre-fills/locks the parent when opened via a node's own "+" (add
// subcategory) button — null for the toolbar's plain "+ Create Category".
let createParentId = null;
let latestTree = [];

// Live `Sortable` instances, one per visible children container — torn
// down and rebuilt on every `renderTree` call (the whole tree DOM is
// rebuilt from scratch each time, same as before this drag-and-drop
// follow-up; SortableJS instances don't survive their DOM element being
// discarded, so this array exists purely so `renderTree` can `.destroy()`
// the previous batch before creating the next one).
let sortableInstances = [];

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = message === '';
}

function showSuccess(message) {
  successEl.textContent = message;
  successEl.hidden = message === '';
}

function showFormError(message) {
  formErrorEl.textContent = message;
  formErrorEl.hidden = message === '';
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

function friendlyErrorMessage(code, fallback) {
  switch (code) {
    case 'ADMIN_FORBIDDEN':
      return 'You do not have permission to manage categories.';
    case 'CATEGORY_NAME_TAKEN':
      return 'A category with this name already exists.';
    case 'CATEGORY_NOT_FOUND':
      return 'This category no longer exists — it may have been deleted elsewhere. Refresh and try again.';
    case 'CATEGORY_PARENT_CYCLE':
      return 'A category cannot become its own descendant’s child.';
    case 'CATEGORY_IN_USE':
      return 'This category cannot be deleted — it is still in use (see the error above).';
    default:
      return fallback;
  }
}

// ---- SVG icons (Tabler-icons-style outline, matching this panel's
// existing inline-SVG convention, e.g. the sidebar nav icons in
// index.html) — built via document.createElementNS, never innerHTML. -----

function svgIcon(paths, { size = 16 } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

const ICONS = {
  chevron: () => svgIcon(['M9 6l6 6-6 6']),
  plus: () => svgIcon(['M12 5v14', 'M5 12h14']),
  up: () => svgIcon(['M12 19V5', 'M5 12l7-7 7 7']),
  down: () => svgIcon(['M12 5v14', 'M19 12l-7 7-7-7']),
  edit: () => svgIcon([
    'M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5',
    'M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  ]),
  trash: () => svgIcon([
    'M4 7h16',
    'M10 11v6',
    'M14 11v6',
    'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12',
    'M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3',
  ]),
  folder: () => svgIcon([
    'M4 5a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5z',
  ]),
  // Two columns of dots — the standard "drag handle" affordance. This is
  // the ONLY element SortableJS is configured to start a drag from (its
  // `handle` option, see `attachSortableInstances`) — grabbing anywhere
  // else on the row does normal things (click name to select text, click
  // the toggle to expand/collapse, etc.) instead of starting a drag.
  grip: () => svgIcon([
    'M9 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M9 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M9 18a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    'M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M15 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M15 18a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  ]),
};

function iconButton(iconName, label, onClick, extraClass) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `gs-tree-icon-button${extraClass ? ` ${extraClass}` : ''}`;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.appendChild(ICONS[iconName]());
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

// ---- Tree rendering -----------------------------------------------------

function flattenTree(nodes, depth = 0) {
  const rows = [];
  nodes.forEach((node) => {
    rows.push({ node, depth });
    if (node.children.length > 0) {
      rows.push(...flattenTree(node.children, depth + 1));
    }
  });
  return rows;
}

function collectDescendantIds(node, acc = new Set()) {
  for (const child of node.children) {
    acc.add(child.id);
    collectDescendantIds(child, acc);
  }
  return acc;
}

function findNodeById(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}

/** The sibling array a node currently belongs to (root list, or its
 * parent's `children`) — the single source of truth `moveSibling`/
 * drag-and-drop both resolve positions against. */
function siblingsOf(node) {
  if (node.parentId === null) return latestTree;
  return findNodeById(latestTree, node.parentId)?.children ?? [];
}

/** Real box-drawn tree guides (│ / ├ / └), the same technique every
 * classic file-explorer/directory-tree renderer uses — NOT ASCII
 * characters, thin CSS borders instead (so they inherit the theme's
 * border color/dark-mode behavior for free). `ancestorIsLast[i]` = "was
 * the ancestor at depth i the LAST child among ITS OWN siblings" — if so,
 * that ancestor's branch has already ended, so the guide column for that
 * depth renders BLANK (no line) instead of a continuing vertical line.
 * `isLast` = is THIS node itself the last child among its own siblings —
 * decides whether THIS row's own connector is a "└" (last) or "├" (has
 * more siblings below, so the line continues past this row). */
function buildTreeGuides(depth, ancestorIsLast, isLast) {
  const wrapper = document.createElement('span');
  wrapper.className = 'gs-tree-guides';
  if (depth === 0) {
    return wrapper; // root nodes: no guides, no elbow.
  }
  for (let level = 0; level < depth - 1; level++) {
    const cell = document.createElement('span');
    cell.className = ancestorIsLast[level]
      ? 'gs-tree-guide-cell'
      : 'gs-tree-guide-cell gs-tree-guide-cell-line';
    wrapper.appendChild(cell);
  }
  const elbow = document.createElement('span');
  elbow.className = isLast ? 'gs-tree-elbow gs-tree-elbow-last' : 'gs-tree-elbow';
  wrapper.appendChild(elbow);
  return wrapper;
}

function buildNodeRow(node, depth, hasChildren, isExpanded, ancestorIsLast, isLast) {
  const row = document.createElement('div');
  row.className = 'gs-category-node-row';
  // No manual `draggable`/drag-event wiring here — SortableJS (see
  // `attachSortableInstances`) owns drag initiation entirely, restricted
  // to `.gs-category-node-grip` via its own `handle` option.
  row.dataset.categoryId = node.id;

  row.appendChild(buildTreeGuides(depth, ancestorIsLast, isLast));

  const grip = document.createElement('span');
  grip.className = 'gs-category-node-grip';
  grip.appendChild(ICONS.grip());
  row.appendChild(grip);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'gs-category-node-toggle';
  if (hasChildren) {
    toggle.setAttribute('aria-expanded', String(isExpanded));
    toggle.setAttribute('aria-label', isExpanded ? 'Collapse' : 'Expand');
    toggle.appendChild(ICONS.chevron());
    toggle.addEventListener('click', () => {
      if (collapsedNodeIds.has(node.id)) {
        collapsedNodeIds.delete(node.id);
      } else {
        collapsedNodeIds.add(node.id);
      }
      renderTree(latestTree);
    });
  } else {
    toggle.classList.add('gs-category-node-toggle-spacer');
    toggle.disabled = true;
    toggle.tabIndex = -1;
  }
  row.appendChild(toggle);

  const folderIcon = document.createElement('span');
  folderIcon.className = 'gs-category-node-icon';
  folderIcon.appendChild(ICONS.folder());
  row.appendChild(folderIcon);

  const name = document.createElement('span');
  name.className = 'gs-category-node-name';
  name.textContent = node.name;
  row.appendChild(name);

  if (hasChildren) {
    const badge = document.createElement('span');
    badge.className = 'badge bg-secondary-lt gs-category-node-badge';
    badge.textContent = String(node.children.length);
    row.appendChild(badge);
  }

  const actions = document.createElement('div');
  actions.className = 'gs-category-node-actions';
  actions.appendChild(
    iconButton('plus', 'Add subcategory', () => openFormDialog({ parentId: node.id })),
  );
  actions.appendChild(
    iconButton('up', 'Move up', () => void moveSibling(node, -1)),
  );
  actions.appendChild(
    iconButton('down', 'Move down', () => void moveSibling(node, 1)),
  );
  actions.appendChild(
    iconButton('edit', 'Edit', () => openFormDialog({ category: node })),
  );
  actions.appendChild(
    iconButton('trash', 'Delete', () => void handleDelete(node), 'gs-tree-icon-button-danger'),
  );
  row.appendChild(actions);

  return row;
}

/** Renders EVERY node's children container whenever the node is expanded
 * — including a genuine LEAF's (empty) container — not just when
 * `children.length > 0`. That empty container is what lets a category
 * with zero children become a drop target for "make this the first
 * child of X" (see `attachSortableInstances`). A leaf's `isExpanded` is
 * always `true` in practice (nothing ever adds a leaf's id to
 * `collapsedNodeIds` — its toggle button is disabled, see `buildNodeRow`),
 * so this "just works" without a separate leaf-specific case. */
function buildNodeElement(node, depth, ancestorIsLast, isLast) {
  const wrapper = document.createElement('div');
  wrapper.className = 'gs-category-node';
  // SortableJS's `draggable: '.gs-category-node'` option means EVERY
  // `evt.item`/`evt.dragged` IS this wrapper element (never the inner
  // `.gs-category-node-row`) — carrying the id here directly, not only on
  // the row, is what lets `attachSortableInstances`'s `onMove`/`onEnd`
  // read it with a plain `.dataset.categoryId`, no `querySelector` needed.
  wrapper.dataset.categoryId = node.id;

  const hasChildren = node.children.length > 0;
  const isExpanded = !collapsedNodeIds.has(node.id);
  wrapper.appendChild(
    buildNodeRow(node, depth, hasChildren, isExpanded, ancestorIsLast, isLast),
  );

  if (isExpanded) {
    const childrenWrapper = document.createElement('div');
    childrenWrapper.className = 'gs-category-node-children';
    childrenWrapper.dataset.parentId = node.id;
    const nextAncestorIsLast = [...ancestorIsLast, isLast];
    node.children.forEach((child, index) => {
      const childIsLast = index === node.children.length - 1;
      childrenWrapper.appendChild(
        buildNodeElement(child, depth + 1, nextAncestorIsLast, childIsLast),
      );
    });
    wrapper.appendChild(childrenWrapper);
  }

  return wrapper;
}

function renderTree(tree) {
  latestTree = tree;
  for (const instance of sortableInstances) {
    instance.destroy();
  }
  sortableInstances = [];
  treeContainer.textContent = '';

  if (tree.length === 0) {
    emptyStateEl.hidden = false;
    return;
  }
  emptyStateEl.hidden = true;

  tree.forEach((rootNode, index) => {
    const isLast = index === tree.length - 1;
    treeContainer.appendChild(buildNodeElement(rootNode, 0, [], isLast));
  });

  attachSortableInstances();
}

// ---- Drag-and-drop (SortableJS — reorder AND re-parent) ------------------
//
// ONE `Sortable` instance per VISIBLE children container: the root
// `#categories-tree` itself (`data-parent-id` left unset -> `null`, root
// level) plus every currently-EXPANDED node's own `.gs-category-node-children`
// (see `buildNodeElement` — this includes empty containers, so a childless
// category is still a valid "drop to make this its first child" target).
// All share one `group` name, which is what makes cross-container drags
// (= re-parenting) possible, not just same-container reordering. A
// COLLAPSED node's children container is never rendered at all, so it
// never gets an instance — there's nothing to visually drop onto, this
// panel's one documented drag-and-drop limitation (see this file's own
// header comment).
function attachSortableInstances() {
  const containers = [
    treeContainer,
    ...treeContainer.querySelectorAll('.gs-category-node-children'),
  ];

  for (const container of containers) {
    const instance = Sortable.create(container, {
      group: 'gs-category-tree',
      handle: '.gs-category-node-grip',
      animation: 150,
      ghostClass: 'gs-category-node-row-ghost',
      chosenClass: 'gs-category-node-row-chosen',
      dragClass: 'gs-category-node-row-drag',
      // Direct children of a `.gs-category-node-children`/`#categories-tree`
      // container are `.gs-category-node` wrappers (row + its own nested
      // children container), never a bare row — dragging always moves the
      // WHOLE subtree, never detaches a row from its own descendants.
      draggable: '.gs-category-node',
      fallbackOnBody: true,
      swapThreshold: 0.65,
      // Generous hit-area for dropping INTO an empty (leaf) container,
      // which otherwise has ~0 height to target — SortableJS's own
      // mechanism for exactly this case.
      emptyInsertThreshold: 24,
      onMove: (evt) => {
        const draggedId = evt.dragged.dataset.categoryId;
        const targetParentId = evt.to.dataset.parentId ?? null;
        if (!draggedId) return true;
        // Forbid dropping a category into its own children container
        // (self-cycle) or into any of its own descendants' containers
        // (would make an ancestor a descendant of its own child) — same
        // rule CATEGORY_PARENT_CYCLE enforces server-side; rejecting it
        // here just gives instant "not allowed" feedback during the drag
        // itself instead of a wasted round-trip.
        if (targetParentId === draggedId) return false;
        const draggedNode = findNodeById(latestTree, draggedId);
        if (draggedNode && collectDescendantIds(draggedNode).has(targetParentId)) {
          return false;
        }
        return true;
      },
      onEnd: (evt) => void handleSortableEnd(evt),
    });
    sortableInstances.push(instance);
  }
}

/** Renumbers `containerEl`'s CURRENT direct children (read straight from
 * the live DOM — SortableJS has already physically moved the dragged
 * element by the time `onEnd` fires) to sequential `displayOrder`
 * (0, 1, 2, …), one `updateCategory` call per node whose `displayOrder`
 * would actually change. `reparentTo`, if given, is applied ONLY to
 * `reparentNodeId` (the just-dragged node) — every other node in the
 * container is purely being renumbered, not re-parented. */
function renumberContainer(containerEl, reparentNodeId, reparentTo) {
  const calls = [];
  const parentId = containerEl.dataset.parentId ?? null;
  Array.from(containerEl.children).forEach((childEl, index) => {
    const id = childEl.dataset.categoryId;
    if (!id) return;
    const node = findNodeById(latestTree, id);
    const input = {};
    if (!node || node.displayOrder !== index) {
      input.displayOrder = index;
    }
    if (id === reparentNodeId && reparentTo !== undefined) {
      input.parentId = reparentTo;
    } else if (!node || node.parentId !== parentId) {
      // Defensive: keeps every OTHER node in this container correctly
      // parented too, in case the DOM and `latestTree` ever disagree.
      input.parentId = parentId;
    }
    if (Object.keys(input).length > 0) {
      calls.push(graphqlRequest(UPDATE_CATEGORY_MUTATION, { id, input }));
    }
  });
  return calls;
}

async function handleSortableEnd(evt) {
  const draggedId = evt.item.dataset.categoryId;
  if (!draggedId) return;

  const toParentId = evt.to.dataset.parentId ?? null;
  const reparented = evt.from !== evt.to;
  if (!reparented && evt.oldIndex === evt.newIndex) {
    return; // dropped back exactly where it started — genuine no-op.
  }

  showError('');
  showSuccess('');
  // SortableJS has already OPTIMISTICALLY moved the real DOM node by this
  // point (that's what makes its animation feel instant) — if anything
  // below fails, the visible tree is now lying about the true server
  // state until it's re-synced. `resynced` tracks whether that already
  // happened via the normal success path, so the `finally` block only
  // does it AGAIN on a failure path — never a double reload on success.
  let resynced = false;

  try {
    const calls = renumberContainer(
      evt.to,
      draggedId,
      reparented ? toParentId : undefined,
    );
    if (reparented) {
      calls.push(...renumberContainer(evt.from));
    }

    const results = await Promise.all(calls);
    for (const body of results) {
      if (body.errors && body.errors.length > 0) {
        if (handleAdminUnauthenticated(body)) return;
        const code = body.errors[0]?.extensions?.code;
        showError(friendlyErrorMessage(code, 'Could not move this category.'));
        return;
      }
    }

    resynced = true;
    await loadCategories();
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    if (!resynced) {
      await loadCategories();
    }
  }
}

// ---- Reorder (↑/↓ buttons — swap displayOrder with the adjacent sibling,
// the accessible/keyboard-operable alternative to dragging) --------------

async function moveSibling(node, direction) {
  const siblings = siblingsOf(node);
  const currentIndex = siblings.findIndex((s) => s.id === node.id);
  const targetIndex = currentIndex + direction;
  if (targetIndex < 0 || targetIndex >= siblings.length) {
    return; // already first/last — nothing to do
  }
  const target = siblings[targetIndex];

  showError('');
  showSuccess('');

  try {
    const [firstResult, secondResult] = await Promise.all([
      graphqlRequest(UPDATE_CATEGORY_MUTATION, {
        id: node.id,
        input: { displayOrder: target.displayOrder },
      }),
      graphqlRequest(UPDATE_CATEGORY_MUTATION, {
        id: target.id,
        input: { displayOrder: node.displayOrder },
      }),
    ]);

    for (const body of [firstResult, secondResult]) {
      if (body.errors && body.errors.length > 0) {
        if (handleAdminUnauthenticated(body)) return;
        const code = body.errors[0]?.extensions?.code;
        showError(friendlyErrorMessage(code, 'Could not reorder categories.'));
        return;
      }
    }

    await loadCategories();
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  }
}

// ---- Create/Edit dialog --------------------------------------------------

function buildParentOption(id, label) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = label;
  return option;
}

/** Populates the "Parent category" select — every category EXCEPT the one
 * being edited and any of ITS OWN descendants (picking one of those would
 * always be rejected server-side as CATEGORY_PARENT_CYCLE; filtering them
 * out client-side is a UX nicety, not the actual enforcement). Indented by
 * depth so the hierarchy is visible in the dropdown itself. */
function populateParentOptions() {
  parentSelect.textContent = '';
  parentSelect.appendChild(buildParentOption('', '— No parent (root level) —'));

  const excludedIds = new Set();
  if (editingCategoryId) {
    excludedIds.add(editingCategoryId);
    const editingNode = findNodeById(latestTree, editingCategoryId);
    if (editingNode) {
      for (const id of collectDescendantIds(editingNode)) {
        excludedIds.add(id);
      }
    }
  }

  for (const { node, depth } of flattenTree(latestTree)) {
    if (excludedIds.has(node.id)) continue;
    const indent = ' '.repeat(depth); // em-space, visual indent only
    parentSelect.appendChild(buildParentOption(node.id, `${indent}${node.name}`));
  }
}

function openFormDialog({ category, parentId } = {}) {
  editingCategoryId = category ? category.id : null;
  createParentId = parentId ?? null;
  form.reset();
  showFormError('');
  populateParentOptions();

  if (category) {
    formHeadingEl.textContent = 'Edit category';
    nameInput.value = category.name;
    displayOrderInput.value = String(category.displayOrder);
    parentSelect.value = category.parentId ?? '';
  } else {
    formHeadingEl.textContent = createParentId ? 'Add subcategory' : 'Create category';
    nameInput.value = '';
    displayOrderInput.value = '0';
    parentSelect.value = createParentId ?? '';
  }

  formDialog.showModal();
}

createRootButton.addEventListener('click', () => openFormDialog());
formCloseButton.addEventListener('click', () => formDialog.close());
formCancelButton.addEventListener('click', () => formDialog.close());

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitForm();
});

async function submitForm() {
  const name = nameInput.value.trim();
  if (!name) {
    showFormError('Enter a name.');
    return;
  }
  const parentId = parentSelect.value || null;
  const displayOrder = Number.parseInt(displayOrderInput.value, 10) || 0;

  showFormError('');
  formSubmitButton.disabled = true;

  try {
    const body = editingCategoryId
      ? await graphqlRequest(UPDATE_CATEGORY_MUTATION, {
          id: editingCategoryId,
          input: { name, displayOrder, parentId },
        })
      : await graphqlRequest(CREATE_CATEGORY_MUTATION, {
          input: { name, displayOrder, parentId: parentId ?? undefined },
        });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        formDialog.close();
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showFormError(friendlyErrorMessage(code, 'Could not save this category. Please try again.'));
      return;
    }

    formDialog.close();
    showSuccess(editingCategoryId ? 'Category updated.' : 'Category created.');
    await loadCategories();
  } catch (error) {
    showFormError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    formSubmitButton.disabled = false;
  }
}

// ---- Delete ---------------------------------------------------------------

async function handleDelete(node) {
  const confirmed = window.confirm(
    `Delete "${node.name}"? This cannot be undone.`,
  );
  if (!confirmed) {
    return;
  }

  showError('');
  showSuccess('');

  try {
    const body = await graphqlRequest(DELETE_CATEGORY_MUTATION, { id: node.id });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) return;
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'CATEGORY_IN_USE'
          ? body.errors[0]?.message || 'This category is still in use and cannot be deleted.'
          : friendlyErrorMessage(code, 'Could not delete this category. Please try again.'),
      );
      return;
    }

    showSuccess(`"${node.name}" has been deleted.`);
    await loadCategories();
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  }
}

// ---------------------------------------------------------------------

export async function loadCategories() {
  showError('');

  try {
    const body = await graphqlRequest(CATEGORY_TREE_QUERY, {});

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) return;
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to view categories.'
          : 'Could not load categories.',
      );
      return;
    }

    renderTree(body.data.adminCategoryTree);
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  }
}
