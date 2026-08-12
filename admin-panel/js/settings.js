// GOS-30/31/32 Slice 2 — "Configuración" section: all platform settings
// (feature flags, third-party credentials, and general configuration
// values), grouped by their shared dot-namespaced key path (e.g.
// `customer.social-login.google.enabled` /
// `customer.social-login.google.client-id` render together, in one
// "Google" settings block, under "Customer" > "Social Login" group
// headings). Renamed from `featureFlags.js` (Slice 1) — same module,
// broadened scope. Layout redesigned (Slice 3) from a card grid to a
// full-width, two-column settings-page pattern — see `renderLeafBlock`.
//
// Backend consolidation (2026-08-08): `FeatureFlag` and `PlatformCredential`
// (two separate models/queries/mutations) were merged into ONE
// `PlatformSetting` model, queried via a single `platformSettings` field and
// written via a single `setPlatformSetting` mutation. `isEncrypted` (was
// `type: 'flag' | 'credential'`) now tells apart a secret (write-only,
// masked-preview) row from a plain-value row, and `valueType`
// (`BOOLEAN` | `STRING` | `NUMBER`) tells apart a boolean toggle from a
// plain text/number field WITHIN the non-encrypted bucket — see
// `renderSettingField`.
//
// `isPublic` removed (2026-08-08 follow-up), then REINTRODUCED (2026-08-10
// follow-up, GOS-3x #2): a manual, independent, default-OFF per-row flag —
// "should this be exposed via the unauthenticated, consumer-facing
// `platformConfig` query?" — separate from `isEncrypted` ("is this a
// secret?"). See `PlatformSetting`'s own header comment in
// `prisma/schema.prisma` and ADR 0005's dedicated section for the full
// reasoning. Rendered here as an "Exponer en platformConfig" checkbox, NOT
// literally "next to an Encriptado checkbox" (this panel has no such
// generic checkbox — which renderer a field gets is DERIVED from
// `setting.isEncrypted`, never chosen through a form control): only
// `renderFlagField` (BOOLEAN) and `renderTextField` (STRING/NUMBER) — the
// two renderers ever used for an `isEncrypted: false` row — render this
// checkbox at all. `renderCredentialField` (the only renderer ever used for
// an `isEncrypted: true` row) never renders it and always sends
// `isPublic: false` — there is no code path through which that renderer
// could ever produce the invalid `isEncrypted: true` + `isPublic: true`
// combination, which is a stronger guarantee than a disable/force-uncheck
// pair on a shared form would have been.
//
// Root tab strip (2026-08-09 follow-up): the root node's direct children
// (e.g. "Customer") no longer render as a collapsible heading group like
// every deeper level does — they render as a horizontal ARIA-tabs strip
// instead (see `renderRootTabs`), and the in-page "Configuración" <h2>
// title moved to visually-hidden (index.html) since the sidebar nav item
// already shows it. Every level BELOW the root (e.g. "Social Login") keeps
// the collapsible disclosure behavior added the round before this one, but
// now defaults to EXPANDED rather than collapsed — see `renderGroupNode`.
//
// Google/Apple client-id no longer encrypted (2026-08-09 follow-up): an
// OAuth "client-id" is a public identifier, not a secret (only a "client
// secret" — never used by this backend — would need real protection), so
// `customer.social-login.google.client-id`/`.apple.client-id` are now
// plain, non-encrypted STRING settings — see `KNOWN_SETTING_SLOTS` (renamed
// from `KNOWN_CREDENTIAL_SLOTS`) below. They render via the existing
// `renderTextField` path, under "Configuración general", same as any other
// plain setting; a leaf block's "Credenciales" sub-heading now only
// appears if it holds a DIFFERENT, still-actually-encrypted setting.
import { graphqlRequest, GraphQLNetworkError } from './graphqlClient.js';
import { clearSession } from './session.js';
import { showLoginView } from './view.js';

const SETTINGS_QUERY = `
  query Settings {
    platformSettings {
      key
      description
      valueType
      isEncrypted
      isPublic
      value
      maskedPreview
      provider
      updatedBy
    }
  }
`;

const SET_PLATFORM_SETTING_MUTATION = `
  mutation SetPlatformSetting($input: SetPlatformSettingInput!) {
    setPlatformSetting(input: $input) {
      key
      description
      valueType
      isEncrypted
      isPublic
      value
      maskedPreview
      provider
      updatedBy
    }
  }
`;

// Setting slots the panel always offers a field for, whether or not a
// `PlatformSetting` row exists yet. Without this, a key that's never been
// saved has NO entry in `platformSettings`, so `buildSettingsTree` would
// never render an input for it at all — meaning there'd be no way to
// configure Google/Apple's client-id for the FIRST time through the UI on a
// fresh environment, only to edit/rotate an already-existing one (found
// live: Apple's card had zero fields until this fix, even though its
// "enabled" flag rendered fine). `description`/`valueType` are included
// because `setPlatformSetting`'s input requires them, and an unconfigured
// slot has no existing row to read them from.
//
// Renamed from `KNOWN_CREDENTIAL_SLOTS` (2026-08-09 follow-up): a Google/
// Apple OAuth "client-id" is a PUBLIC identifier by design (that's how
// native Google/Apple Sign-In SDKs are configured — it's meant to be
// embedded directly in a mobile app), never a secret — only a "client
// secret" would need real protection, and this backend only ever reads the
// client-id (for the `aud` claim check — see
// `src/auth/adapters/jose-social-identity-validation.adapter.ts`), never a
// client secret. Both slots below are now non-encrypted STRING settings,
// so they render via `renderTextField` (pre-filled, visible value, under
// "Configuración general") rather than the write-only credential-field
// path — `provider` is dropped since it's only meaningful for an
// `isEncrypted: true` row (see `SetPlatformSettingInput.provider`'s own
// comment), and neither `renderTextField`/`handleSaveSetting` reads it.
//
// Each slot now carries its OWN `isEncrypted` (2026-08-10 follow-up, GOS-3x
// — added alongside the Resend `api-key` slot below): until this round,
// `buildSettingsTree`'s slot-insertion loop HARDCODED `isEncrypted: false`
// for every slot, which happened to be harmless while both entries here
// were non-encrypted client-ids, but would have silently rendered a
// write-only credential (like Resend's `api-key`) as a plain, pre-filled
// text field instead — a real bug, not just a style issue. Kept generic on
// purpose: nothing in `buildSettingsTree` special-cases any one slot by
// name.
const KNOWN_SETTING_SLOTS = [
  {
    key: 'customer.social-login.google.client-id',
    description: 'Google client-id.',
    valueType: 'STRING',
    isEncrypted: false,
  },
  {
    key: 'customer.social-login.apple.client-id',
    description: 'Apple client-id.',
    valueType: 'STRING',
    isEncrypted: false,
  },
  {
    key: 'notifications.email.resend.enabled',
    description: 'Gates Resend transactional email delivery.',
    valueType: 'BOOLEAN',
    isEncrypted: false,
  },
  {
    key: 'notifications.email.resend.api-key',
    description: 'Resend API key (transactional email delivery).',
    valueType: 'STRING',
    isEncrypted: true,
  },
  {
    key: 'notifications.email.resend.from-address',
    description: 'Verified "from" address Resend sends email as.',
    valueType: 'STRING',
    isEncrypted: false,
  },
  {
    key: 'notifications.email.resend.from-name',
    description: '"From" display name Resend sends email as.',
    valueType: 'STRING',
    isEncrypted: false,
  },
];

// Short, static, one-line descriptions shown under a leaf block's title
// (e.g. "Google", "Apple"), keyed by the block's humanized label (see
// `humanizeSegment`). Deliberately a flat lookup rather than derived prose
// from data — simpler, and every future provider/leaf just needs one more
// entry here. A label with no entry simply renders no description
// (`describeLeafBlock` returns '') rather than throwing or showing a
// placeholder.
const LEAF_BLOCK_DESCRIPTIONS = {
  Google: 'Google sign-in configuration.',
  Apple: 'Apple sign-in configuration.',
  Resend: 'Resend transactional email provider configuration.',
};

function describeLeafBlock(label) {
  return LEAF_BLOCK_DESCRIPTIONS[label] ?? '';
}

// A leaf node's fields (each a full `PlatformSettingModel`-shaped object)
// are grouped, at RENDER time only, by `setting.isEncrypted` — never by
// renaming/re-keying the data itself. This is the sole mapping from
// `isEncrypted` to the sub-heading it renders under; ordering here
// (general before encrypted) is also the display order within a leaf
// block's right column.
const FIELD_TYPE_GROUP_LABELS = {
  general: 'General configuration',
  encrypted: 'Credentials',
};

const contentEl = document.getElementById('settings-content');
const errorEl = document.getElementById('settings-error');

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = message === '';
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

/**
 * Humanizes one dot-path segment for display — `social-login` -> "Social
 * Login", `google` -> "Google", `client-id` -> "Client Id". Purely
 * cosmetic; the real, load-bearing identifier is always the full key, never
 * this derived label.
 */
function humanizeSegment(segment) {
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Builds a generic path tree from every setting's dot-namespaced key. A
 * key's LAST segment (e.g. `enabled`, `client-id`) names a FIELD within a
 * settings block; every segment BEFORE that names the group/block
 * hierarchy the field lives under. A tree node is rendered as a LEAF BLOCK
 * once it holds at least one field; otherwise it's rendered as a group
 * heading wrapping its children — this works for whatever depth/shape
 * future keys use, not just today's 4-segment
 * `customer.social-login.<provider>.<field>` shape.
 *
 * Each field stores the full `PlatformSettingModel`-shaped object directly
 * (no `{ type, data }` wrapper — `isEncrypted`/`valueType` on the object
 * itself are enough for `renderSettingField` to pick the right control).
 */
function buildSettingsTree(settings) {
  const root = { label: null, children: {}, fields: {} };

  function insert(key, setting) {
    const segments = key.split('.');
    const fieldName = segments[segments.length - 1];
    const groupSegments = segments.slice(0, -1);

    let node = root;
    for (const segment of groupSegments) {
      if (!node.children[segment]) {
        node.children[segment] = {
          label: humanizeSegment(segment),
          children: {},
          fields: {},
        };
      }
      node = node.children[segment];
    }
    node.fields[fieldName] = setting;
  }

  const configuredKeys = new Set();
  for (const setting of settings) {
    configuredKeys.add(setting.key);
    insert(setting.key, setting);
  }

  // Any known setting slot without a real row yet still gets a field — see
  // KNOWN_SETTING_SLOTS' own comment for why this is load-bearing, not
  // decorative. `value: null` is what renderTextField already treats as
  // "no value yet" (`setting.value ?? ''`), same as a real, never-saved
  // non-encrypted setting would look like.
  for (const slot of KNOWN_SETTING_SLOTS) {
    if (configuredKeys.has(slot.key)) continue;
    insert(slot.key, {
      key: slot.key,
      description: slot.description,
      valueType: slot.valueType,
      // Read from the slot's OWN `isEncrypted` (see KNOWN_SETTING_SLOTS'
      // own comment) — no longer hardcoded `false`, so an encrypted slot
      // (e.g. Resend's `api-key`) correctly renders the write-only
      // credential-field UI even before any row exists, same as a
      // non-encrypted slot renders `renderTextField`.
      isEncrypted: slot.isEncrypted,
      // Never-configured-yet placeholder defaults to NOT public, matching
      // `PlatformSetting.isPublic`'s own DB default — an admin must
      // deliberately opt a brand-new setting in.
      isPublic: false,
      value: null,
      maskedPreview: null,
      provider: null,
      updatedBy: null,
    });
  }

  return root;
}

function sortedEntries(obj) {
  return Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Orders one leaf block's FIELDS for display (unlike `sortedEntries` above,
 * used for tree GROUPS/tabs, which stays plain alphabetical) — the
 * BOOLEAN enable/disable-style field, if the leaf has one, always renders
 * FIRST, ahead of every other field (client-id, etc.), which then follow
 * alphabetically among themselves. An admin scans for "is this feature on
 * at all" before its supporting configuration, so that field belongs at the
 * top of the group, not wherever it happens to fall alphabetically (today,
 * `client-id` < `enabled` sorts the toggle LAST — confusing, since the
 * toggle is the field that actually matters most). Generic on
 * `valueType === 'BOOLEAN'`, not hardcoded to the literal field name
 * `enabled`, so this holds for any future leaf/field reusing the same
 * BOOLEAN-flag pattern.
 */
function sortedFieldEntries(fields) {
  return Object.entries(fields).sort(([nameA, settingA], [nameB, settingB]) => {
    const aIsBoolean = settingA.valueType === 'BOOLEAN';
    const bIsBoolean = settingB.valueType === 'BOOLEAN';
    if (aIsBoolean !== bIsBoolean) {
      return aIsBoolean ? -1 : 1;
    }
    return nameA.localeCompare(nameB);
  });
}

/**
 * Builds one small chevron-right icon (inline SVG, matching the style of
 * every other icon already used in this admin panel — see the sidebar nav
 * icons in `index.html`: 24x24 viewBox, `stroke="currentColor"`,
 * `stroke-width="2"`, round caps/joins, `aria-hidden="true"`). Used as a
 * group-disclosure indicator — `admin-theme.css` rotates it 90° when its
 * parent `.gs-settings-group-toggle` is `aria-expanded="true"`, so it
 * visually points right when collapsed and down when expanded.
 */
function createChevronIcon() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('gs-settings-group-chevron');

  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', 'M9 6l6 6l-6 6');
  svg.appendChild(path);

  return svg;
}

/**
 * Renders one BOOLEAN, non-encrypted setting as a native sliding switch —
 * an `<input type="checkbox" role="switch">` inside Bootstrap/Tabler's own
 * vendored `.form-check.form-switch` markup (the same control this panel
 * already used for the now-removed "Público" checkbox), rather than a
 * hand-styled `<button>`. Chosen over hand-styling a `<button>` to LOOK
 * like a switch because the native checkbox gets the exact track+thumb
 * look, the checked-state blue fill, and the disabled-state dimming for
 * free from the already-vendored, already-CSP-cleared `tabler.min.css` —
 * see `admin-theme.css`'s own note on this control for the full reasoning.
 *
 * This is a VISUAL-only change from the former pill-badge
 * `<button role="switch">`: `role="switch"` is still present,
 * `aria-checked` is still kept in sync with the actual state on every
 * change (including the loading/disabled state during the network
 * request), and `aria-label` still ANNOUNCES the current state, not just
 * shows it — see `handleToggle`.
 */
function renderFlagField(setting) {
  const enabled = setting.value === 'true';
  const isPublic = setting.isPublic === true;

  const row = document.createElement('div');
  row.className = 'd-flex align-items-center justify-content-between mb-2';

  const label = document.createElement('span');
  label.className = 'text-secondary';
  // Static "Habilitar" (not `setting.description`, e.g. "Gates Apple
  // sign-in (socialLogin APPLE).") — that raw description is internal,
  // technical documentation for whoever reads the DB row directly, never
  // meant to double as this toggle's user-facing label. The leaf block's
  // own title (e.g. "Google"/"Apple", see `renderLeafBlock`) already gives
  // this row its context, so a short, standard "Habilitar" reads clearly
  // without repeating it. `setting.description` is still preserved
  // unchanged in `toggle.dataset.description` below, round-tripped back on
  // save — only this VISIBLE label changed, not the stored value.
  label.textContent = 'Enable';

  const controls = document.createElement('div');
  controls.className = 'd-flex align-items-center gap-3';

  // "Exponer en platformConfig" — a plain (non-switch) checkbox, visually
  // distinct from the `enabled` switch below even though both are
  // booleans, so an admin never confuses "is the feature on" with "is this
  // setting visible to mobile". Auto-saves on change, same pattern as the
  // `enabled` switch — see `handleToggle`, which now saves BOTH controls'
  // current state together on either one's change.
  const publicWrapper = document.createElement('div');
  publicWrapper.className = 'form-check mb-0';

  const publicCheckbox = document.createElement('input');
  publicCheckbox.type = 'checkbox';
  publicCheckbox.className = 'form-check-input';
  publicCheckbox.id = `expose-checkbox-${setting.key}`;
  publicCheckbox.checked = isPublic;
  publicCheckbox.dataset.lastKnownGood = String(isPublic);

  const publicLabel = document.createElement('label');
  publicLabel.className = 'form-check-label small text-secondary';
  publicLabel.setAttribute('for', publicCheckbox.id);
  publicLabel.textContent = 'Expose in platformConfig';

  publicWrapper.append(publicCheckbox, publicLabel);

  const switchWrapper = document.createElement('div');
  switchWrapper.className = 'form-check form-switch mb-0';

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'form-check-input';
  toggle.setAttribute('role', 'switch');
  toggle.checked = enabled;
  toggle.setAttribute('aria-checked', String(enabled));
  toggle.setAttribute(
    'aria-label',
    `Toggle ${setting.key} (${enabled ? 'enabled' : 'disabled'})`,
  );
  toggle.dataset.key = setting.key;
  toggle.dataset.description = setting.description;
  toggle.dataset.lastKnownGood = String(enabled);

  toggle.addEventListener('change', () => handleToggle(toggle, publicCheckbox));
  publicCheckbox.addEventListener('change', () =>
    handleToggle(toggle, publicCheckbox),
  );

  switchWrapper.appendChild(toggle);
  controls.append(publicWrapper, switchWrapper);
  row.append(label, controls);
  return row;
}

/**
 * A native `<input type="checkbox">` already flips its own `.checked` state
 * as part of the click, BEFORE this `change` handler ever runs —
 * `toggleEl.checked`/`publicCheckboxEl.checked` here are therefore already
 * the DESIRED next state, not the previous one. This is why failure/error
 * paths below explicitly revert BOTH controls' state — using each one's own
 * `dataset.lastKnownGood` (set at render time and updated on every
 * successful save) rather than blindly inverting the current value, since
 * only ONE of the two controls actually triggered any given call to this
 * function (its own `change` event fired; the other's did not).
 *
 * Saves BOTH controls' current state together on either one's `change` —
 * `enabled` and `isPublic` are two independent fields on the SAME
 * `PlatformSetting` row, and `SetPlatformSettingInput` always expects the
 * full desired state of a row, not a partial patch (same convention as
 * every other `setPlatformSetting` call site in this panel).
 */
async function handleToggle(toggleEl, publicCheckboxEl) {
  showError('');
  toggleEl.disabled = true;
  publicCheckboxEl.disabled = true;

  const key = toggleEl.dataset.key;
  const description = toggleEl.dataset.description;
  const nextEnabled = toggleEl.checked;
  const nextPublic = publicCheckboxEl.checked;
  const previousEnabled = toggleEl.dataset.lastKnownGood === 'true';
  const previousPublic = publicCheckboxEl.dataset.lastKnownGood === 'true';

  function applyState(isEnabled, isPublicValue) {
    toggleEl.checked = isEnabled;
    toggleEl.setAttribute('aria-checked', String(isEnabled));
    toggleEl.setAttribute(
      'aria-label',
      `Toggle ${key} (${isEnabled ? 'enabled' : 'disabled'})`,
    );
    toggleEl.dataset.lastKnownGood = String(isEnabled);
    publicCheckboxEl.checked = isPublicValue;
    publicCheckboxEl.dataset.lastKnownGood = String(isPublicValue);
  }

  try {
    const body = await graphqlRequest(SET_PLATFORM_SETTING_MUTATION, {
      input: {
        key,
        description,
        valueType: 'BOOLEAN',
        isEncrypted: false,
        isPublic: nextPublic,
        value: String(nextEnabled),
      },
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to change feature flags.'
          : 'Could not update the flag. Please try again.',
      );
      applyState(previousEnabled, previousPublic); // Revert — the mutation did not apply.
      return;
    }

    const updated = body.data.setPlatformSetting;
    applyState(updated.value === 'true', updated.isPublic === true);
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
    applyState(previousEnabled, previousPublic); // Revert — the mutation did not apply.
  } finally {
    toggleEl.disabled = false;
    publicCheckboxEl.disabled = false;
  }
}

/**
 * Renders one ENCRYPTED setting field as a write-only input + "Guardar"
 * button, with the current `maskedPreview` shown alongside for
 * confirmation. NON-NEGOTIABLE UX rule: the input starts empty, ALWAYS —
 * the real value is never fetched or pre-filled (the backend never even
 * returns it when `isEncrypted: true` — see `PlatformSettingModel.value`).
 * Submitting an EMPTY value means "don't change it": no mutation call is
 * made at all, the button is effectively a no-op in that case. Only a
 * NON-EMPTY value triggers `setPlatformSetting`.
 */
function renderCredentialField(fieldName, setting) {
  const wrapper = document.createElement('div');
  wrapper.className = 'mb-2';

  const labelRow = document.createElement('div');
  labelRow.className = 'd-flex align-items-center justify-content-between mb-1';

  const label = document.createElement('label');
  label.className = 'form-label mb-0';
  label.textContent = humanizeSegment(fieldName);
  const inputId = `credential-input-${setting.key}`;
  label.setAttribute('for', inputId);

  const previewEl = document.createElement('span');
  // `maskedPreview === null` -> KNOWN_SETTING_SLOTS filled this field in
  // even though no PlatformSetting row exists yet (see buildSettingsTree) —
  // tell "never configured" apart from "configured, write-only" instead of
  // rendering "termina en null".
  if (setting.maskedPreview === null) {
    previewEl.className = 'text-warning small';
    previewEl.textContent = 'Not configured yet';
  } else {
    previewEl.className = 'text-secondary small';
    previewEl.textContent = `ends in ${setting.maskedPreview}`;
  }

  labelRow.append(label, previewEl);

  const inputGroup = document.createElement('div');
  inputGroup.className = 'input-group';

  const input = document.createElement('input');
  input.type = 'password';
  input.id = inputId;
  input.className = 'form-control';
  input.autocomplete = 'off';
  input.placeholder =
    setting.maskedPreview === null
      ? 'Enter a value'
      : 'Leave blank to keep unchanged';
  input.value = ''; // ALWAYS starts empty — never pre-filled.

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn-primary';
  saveButton.textContent = 'Save';

  saveButton.addEventListener('click', () =>
    handleSaveCredential(setting, input, previewEl),
  );

  inputGroup.append(input, saveButton);
  wrapper.append(labelRow, inputGroup);
  return wrapper;
}

async function handleSaveCredential(setting, inputEl, previewEl) {
  const value = inputEl.value;
  // Empty submission = "don't change it": no mutation call at all.
  if (value === '') {
    return;
  }

  showError('');
  inputEl.disabled = true;

  try {
    const body = await graphqlRequest(SET_PLATFORM_SETTING_MUTATION, {
      input: {
        key: setting.key,
        description: setting.description,
        valueType: setting.valueType,
        isEncrypted: true,
        // Always false — an encrypted setting can never also be public (a
        // hard veto, enforced by the backend too). This renderer never
        // offers an "Exponer" checkbox at all, so there is no code path
        // here that could ever send `true`.
        isPublic: false,
        value,
        provider: setting.provider,
      },
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to change credentials.'
          : 'Could not save the credential. Please try again.',
      );
      return;
    }

    const updated = body.data.setPlatformSetting;
    // className reset too, not just textContent — a first-ever save on a
    // KNOWN_SETTING_SLOTS placeholder had the "no configurado todavía"
    // warning styling (see renderCredentialField), which must not linger
    // once a real value exists.
    previewEl.className = 'text-secondary small';
    previewEl.textContent = `ends in ${updated.maskedPreview}`;
    // Placeholder text also reverts, same reasoning.
    inputEl.placeholder = 'Leave blank to keep unchanged';
    // Always cleared back to empty after a successful save — never left
    // holding the plaintext the admin just typed in.
    inputEl.value = '';
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    inputEl.disabled = false;
  }
}

/**
 * Renders one STRING/NUMBER, non-encrypted setting as a labeled input
 * PRE-FILLED with its current `value` (these aren't secrets — unlike
 * `renderCredentialField`'s write-only pattern, showing the current value
 * is correct and expected) + a "Guardar" button that commits it. Basic
 * client-side validation for NUMBER is via `input type="number"` only
 * (native browser validation) — the backend validates authoritatively.
 */
function renderTextField(fieldName, setting) {
  const wrapper = document.createElement('div');
  wrapper.className = 'mb-2';

  const labelRow = document.createElement('div');
  labelRow.className = 'd-flex align-items-center justify-content-between mb-1';

  const label = document.createElement('label');
  label.className = 'form-label mb-0';
  label.textContent = humanizeSegment(fieldName);
  const inputId = `setting-input-${setting.key}`;
  label.setAttribute('for', inputId);

  // "Exponer en platformConfig" — saved together with the field's own
  // value when "Guardar" is clicked (not auto-saving on its own change,
  // unlike `renderFlagField`'s equivalent — this field already has an
  // explicit save action, so the checkbox just rides along with it).
  const publicWrapper = document.createElement('div');
  publicWrapper.className = 'form-check mb-0';

  const publicCheckbox = document.createElement('input');
  publicCheckbox.type = 'checkbox';
  publicCheckbox.className = 'form-check-input';
  publicCheckbox.id = `expose-checkbox-${setting.key}`;
  publicCheckbox.checked = setting.isPublic === true;

  const publicLabel = document.createElement('label');
  publicLabel.className = 'form-check-label small text-secondary';
  publicLabel.setAttribute('for', publicCheckbox.id);
  publicLabel.textContent = 'Expose in platformConfig';

  publicWrapper.append(publicCheckbox, publicLabel);
  labelRow.append(label, publicWrapper);

  const inputGroup = document.createElement('div');
  inputGroup.className = 'input-group';

  const input = document.createElement('input');
  input.type = setting.valueType === 'NUMBER' ? 'number' : 'text';
  input.id = inputId;
  input.className = 'form-control';
  input.autocomplete = 'off';
  input.value = setting.value ?? ''; // Pre-filled — not a secret.

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn-primary';
  saveButton.textContent = 'Save';

  saveButton.addEventListener('click', () =>
    handleSaveSetting(setting, input, publicCheckbox, saveButton),
  );

  inputGroup.append(input, saveButton);
  wrapper.append(labelRow, inputGroup);
  return wrapper;
}

async function handleSaveSetting(setting, inputEl, publicCheckboxEl, saveButton) {
  showError('');
  inputEl.disabled = true;
  publicCheckboxEl.disabled = true;
  saveButton.disabled = true;

  try {
    const body = await graphqlRequest(SET_PLATFORM_SETTING_MUTATION, {
      input: {
        key: setting.key,
        description: setting.description,
        valueType: setting.valueType,
        isEncrypted: false,
        isPublic: publicCheckboxEl.checked,
        value: inputEl.value,
      },
    });

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      const code = body.errors[0]?.extensions?.code;
      showError(
        code === 'ADMIN_FORBIDDEN'
          ? 'You do not have permission to change settings.'
          : 'Could not save the setting. Please try again.',
      );
      return;
    }

    const updated = body.data.setPlatformSetting;
    inputEl.value = updated.value ?? '';
    publicCheckboxEl.checked = updated.isPublic === true;
  } catch (error) {
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  } finally {
    inputEl.disabled = false;
    publicCheckboxEl.disabled = false;
    saveButton.disabled = false;
  }
}

/**
 * Dispatches one field (a full `PlatformSettingModel`-shaped object) to the
 * right renderer: encrypted settings are always write-only credential
 * fields (regardless of `valueType`); non-encrypted settings render as
 * either the BOOLEAN toggle or the STRING/NUMBER text field depending on
 * `valueType`.
 */
function renderSettingField(fieldName, setting) {
  if (setting.isEncrypted) {
    return renderCredentialField(fieldName, setting);
  }
  if (setting.valueType === 'BOOLEAN') {
    return renderFlagField(setting);
  }
  return renderTextField(fieldName, setting);
}

/**
 * Renders one leaf node (a node that holds at least one field) as a
 * full-width, two-column settings row — NOT a Tabler card. Left column:
 * bold title + short static description (see `LEAF_BLOCK_DESCRIPTIONS`).
 * Right column: the node's fields, grouped by `setting.isEncrypted` into
 * "Configuración general" (non-encrypted) / "Credenciales" (encrypted)
 * sub-groups, each under a small label-style sub-heading — a bucket with no
 * entries renders no sub-heading at all (e.g. a future leaf with only
 * general settings, no credentials).
 */
function renderLeafBlock(node, headingLevel) {
  const block = document.createElement('div');
  block.className = 'row gs-settings-block';

  const left = document.createElement('div');
  left.className = 'col-12 col-md-3 gs-settings-block-left';

  const title = document.createElement(
    headingLevel <= 6 ? `h${headingLevel}` : 'h6',
  );
  title.className = 'gs-settings-block-title';
  title.textContent = node.label;
  left.appendChild(title);

  const description = describeLeafBlock(node.label);
  if (description !== '') {
    const descriptionEl = document.createElement('p');
    descriptionEl.className = 'gs-settings-block-description text-secondary';
    descriptionEl.textContent = description;
    left.appendChild(descriptionEl);
  }

  const right = document.createElement('div');
  right.className = 'col-12 col-md-9 gs-settings-block-right';

  // Group by `setting.isEncrypted` (pure render-time grouping, no data
  // renaming) — 'general' before 'encrypted' matches FIELD_TYPE_GROUP_LABELS'
  // own order.
  const buckets = { general: [], encrypted: [] };
  for (const [fieldName, setting] of sortedFieldEntries(node.fields)) {
    buckets[setting.isEncrypted ? 'encrypted' : 'general'].push([
      fieldName,
      setting,
    ]);
  }

  for (const bucketKey of ['general', 'encrypted']) {
    const bucketEntries = buckets[bucketKey];
    if (bucketEntries.length === 0) continue;

    const subheading = document.createElement('div');
    subheading.className = 'gs-settings-subheading';
    subheading.textContent = FIELD_TYPE_GROUP_LABELS[bucketKey];
    right.appendChild(subheading);

    for (const [fieldName, setting] of bucketEntries) {
      right.appendChild(renderSettingField(fieldName, setting));
    }
  }

  block.append(left, right);
  return block;
}

// Monotonically increasing across the module's lifetime — every call to
// `renderGroupNode` that creates a new collapsible group gets a fresh,
// unique `id` for its content wrapper (used by that toggle's own
// `aria-controls`). Never reset: `loadSettings` rebuilds the WHOLE tree
// from scratch on every load (`contentEl.textContent = ''` discards every
// previously rendered element first), so a growing counter across reloads
// never risks an `id` collision among elements that coexist in the DOM at
// the same time.
let groupContentIdCounter = 0;

/**
 * Renders the CHILDREN of one tree node (a stack of full-width leaf
 * blocks, for children that are themselves leaves, separated by `<hr>`
 * dividers between siblings only — never inside one leaf block's own two
 * sub-groups — plus nested, collapsible group sections, for children that
 * are groups) into a DocumentFragment. A child can be a leaf (has fields)
 * even if ITS OWN children map is also non-empty in some future,
 * deeper-nested key shape, so leaf-ness is checked first and takes
 * priority.
 *
 * Shared by two callers that differ only in what WRAPS this fragment:
 * `renderGroupNode` (a sub-root group, e.g. "Social Login" — wraps it in
 * its own collapsible disclosure heading) and `renderRootTabPanelContent`
 * (a root group's tab panel, e.g. "Customer" — wraps it in nothing extra,
 * since the tab button already carries that label; see `renderRootTabs`).
 */
function renderGroupChildren(node, headingLevel) {
  const contentFragment = document.createDocumentFragment();

  const childEntries = sortedEntries(node.children);
  const leafChildren = childEntries.filter(([, child]) =>
    Object.keys(child.fields).length > 0,
  );
  const groupChildren = childEntries.filter(
    ([, child]) => Object.keys(child.fields).length === 0,
  );

  if (leafChildren.length > 0) {
    const blocksContainer = document.createElement('div');
    blocksContainer.className = 'gs-settings-blocks mb-3';
    leafChildren.forEach(([, child], index) => {
      if (index > 0) {
        blocksContainer.appendChild(document.createElement('hr'));
      }
      blocksContainer.appendChild(renderLeafBlock(child, headingLevel + 1));
    });
    contentFragment.appendChild(blocksContainer);
  }

  for (const [, child] of groupChildren) {
    const section = document.createElement('div');
    section.className = 'gs-settings-group mb-3';
    section.appendChild(renderGroupNode(child, headingLevel + 1));
    contentFragment.appendChild(section);
  }

  return contentFragment;
}

/**
 * Recursively renders one SUB-ROOT group node — i.e. anything BELOW a root
 * tab (e.g. "Social Login" nested inside the "Customer" tab, and whatever
 * nests inside or alongside it later): an accessible, collapsible
 * disclosure — a `<button>` heading wrapping the group's label + a chevron
 * icon, controlling a `hidden` content container that holds
 * `renderGroupChildren`'s output.
 *
 * EVERY level below a root tab gets this same disclosure treatment,
 * generically — nothing here is hardcoded to "Social Login" specifically,
 * so it scales to however many/deep future config groups exist under a
 * root tab. As of 2026-08-09, a group's content starts EXPANDED
 * (`hidden = false`) by default, not collapsed — now that top-level noise
 * is already reduced by the root tab strip (see `renderRootTabs`), a
 * subgroup doesn't also need to start collapsed; only the root level ever
 * needed that treatment, and only because many root groups can exist side
 * by side. Clicking the heading still toggles `aria-expanded` on the
 * button and `hidden` on the content container — the same plain
 * `hidden`-attribute pattern already used elsewhere in this codebase for
 * view/section switching (see `js/view.js`/`js/nav.js`).
 *
 * The heading's rendered element tag (h3/h4/...) always follows
 * `headingLevel` exactly — never skipped — so a deeply-nested group is
 * both semantically correct AND, via `admin-theme.css`, visually
 * smaller/label-styled than its shallower ancestor. The toggle `<button>`
 * lives INSIDE that heading element (not replacing it), so every existing
 * heading-level CSS rule (`.gs-settings-group-heading`,
 * `h4.gs-settings-group-heading`, etc.) keeps applying unchanged.
 *
 * Root-level groups (e.g. "Customer") are NEVER passed to this function —
 * see `renderRootTabs`, which renders them as tabs instead, since tabs are
 * not heading elements per the ARIA APG tabs pattern.
 */
function renderGroupNode(node, headingLevel) {
  const fragment = document.createDocumentFragment();
  const contentFragment = renderGroupChildren(node, headingLevel);

  const contentId = `gs-settings-group-content-${groupContentIdCounter++}`;
  const groupContentEl = document.createElement('div');
  groupContentEl.id = contentId;
  groupContentEl.className = 'gs-settings-group-content';
  groupContentEl.hidden = false; // Expanded by default — see function comment.
  groupContentEl.appendChild(contentFragment);

  const heading = document.createElement(
    headingLevel <= 6 ? `h${headingLevel}` : 'h6',
  );
  heading.className = 'gs-settings-group-heading';

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'gs-settings-group-toggle';
  toggleButton.setAttribute('aria-expanded', 'true');
  toggleButton.setAttribute('aria-controls', contentId);

  const labelText = document.createElement('span');
  labelText.textContent = node.label;

  toggleButton.append(createChevronIcon(), labelText);
  toggleButton.addEventListener('click', () => {
    const isExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
    const nextExpanded = !isExpanded;
    toggleButton.setAttribute('aria-expanded', String(nextExpanded));
    groupContentEl.hidden = !nextExpanded;
  });

  heading.appendChild(toggleButton);
  fragment.append(heading, groupContentEl);
  return fragment;
}

/**
 * Renders the content of ONE root group's tab panel (e.g. "Customer"'s
 * panel — see `renderRootTabs`). If the root group itself carries fields
 * directly (a key with only two segments, e.g. a hypothetical
 * `customer.something` — the tree structure allows this even though
 * today's real keys are all deeper), it's a leaf in its own right and
 * renders as a single leaf block; leaf-ness is checked first and takes
 * priority, same rule `renderGroupChildren` already applies one level
 * down. Otherwise — the common case, e.g. "Customer" wrapping "Social
 * Login" — its children render exactly like any other group's children:
 * `renderGroupChildren` doesn't know or care whether its caller is a root
 * tab panel or a nested group's disclosure content.
 *
 * `headingLevel` here is the same baseline (2) `loadSettings` always
 * passes for the whole tree. The root's direct children no longer get
 * their own heading element (they're tabs now, not headings — tabs are
 * not heading elements per the ARIA APG tabs pattern), so each tab panel
 * restarts heading numbering exactly where the page's own, now
 * visually-hidden, `<h2>` left off: the panel's first heading is
 * `headingLevel + 1` (h3), never skipping from the hidden h2 straight to
 * h4.
 */
function renderRootTabPanelContent(node, headingLevel) {
  const hasOwnFields = Object.keys(node.fields).length > 0;
  if (hasOwnFields) {
    return renderLeafBlock(node, headingLevel + 1);
  }
  return renderGroupChildren(node, headingLevel);
}

/**
 * Renders the root node's direct children (today: just "Customer" — but
 * this is deliberately generic, ready for more root-level groups later
 * without a rewrite) as a horizontal tab strip, per the ARIA APG tabs
 * pattern: a `role="tablist"` container (`aria-label="Configuración"`,
 * since the tablist itself needs an accessible name per the pattern) of
 * `role="tab"` buttons (`aria-selected`, `aria-controls` pointing at their
 * panel's `id`, and their own `id` for the panel's `aria-labelledby` to
 * point back at), each controlling a `role="tabpanel"`
 * (`tabindex="0"`, so it's reachable/focusable on its own). Only the
 * selected tab's panel is visible — `hidden` on the rest, the same plain
 * `hidden`-attribute pattern already used everywhere else in this panel —
 * and the FIRST root group is selected by default.
 *
 * `selectTab` is the single place that updates every tab's
 * `aria-selected`/`.active` state and every panel's `hidden` state
 * together, so they can never fall out of sync; it's wired to both a
 * click on any tab and, per the ARIA APG's "automatic activation" model
 * for tabs, Left/Right/Home/End keydown on a focused tab (arrow keys move
 * focus AND select — Tab/Shift+Tab still leave the tablist entirely, via
 * the roving `tabIndex` below, which keeps only the selected tab in the
 * page's normal Tab order).
 *
 * Even with a single root group today, this still renders a (single-item)
 * tab strip rather than special-casing "only one root group exists" — the
 * whole point is to already be structurally ready for more root groups
 * appearing later.
 */
function renderRootTabs(root, headingLevel) {
  const rootEntries = sortedEntries(root.children);
  const lastIndex = rootEntries.length - 1;

  const wrapper = document.createDocumentFragment();

  const tablist = document.createElement('div');
  tablist.className = 'nav nav-underline gs-settings-tablist';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Settings');

  const panelsWrapper = document.createElement('div');
  panelsWrapper.className = 'gs-settings-tabpanels';

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
  }

  rootEntries.forEach(([key, child], index) => {
    const isSelected = index === 0;
    const tabId = `gs-settings-tab-${key}`;
    const panelId = `gs-settings-panel-${key}`;

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
    tabButton.textContent = child.label;
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
    panel.className = 'gs-settings-tabpanel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabId);
    panel.tabIndex = 0;
    panel.hidden = !isSelected;
    panel.appendChild(renderRootTabPanelContent(child, headingLevel));

    panelsWrapper.appendChild(panel);
    panels.push(panel);
  });

  wrapper.append(tablist, panelsWrapper);
  return wrapper;
}

export async function loadSettings() {
  showError('');
  contentEl.textContent = 'Loading…';

  try {
    const body = await graphqlRequest(SETTINGS_QUERY);

    if (body.errors && body.errors.length > 0) {
      if (handleAdminUnauthenticated(body)) {
        return;
      }
      contentEl.textContent = '';
      showError('Could not load settings.');
      return;
    }

    contentEl.textContent = '';
    const tree = buildSettingsTree(body.data.platformSettings);
    // The root node's direct children (e.g. "Customer") render as a
    // horizontal tab strip, not as headings — see `renderRootTabs`. `2` is
    // the same baseline used before this round (one level below the
    // page's own, now visually-hidden, <h2> "Configuración" landmark); see
    // `renderRootTabPanelContent` for how that baseline carries into each
    // tab panel's own heading numbering.
    contentEl.appendChild(renderRootTabs(tree, 2));
  } catch (error) {
    contentEl.textContent = '';
    showError(
      error instanceof GraphQLNetworkError
        ? error.message
        : 'Something went wrong. Please try again.',
    );
  }
}
