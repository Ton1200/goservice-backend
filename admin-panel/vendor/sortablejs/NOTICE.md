# Vendored: SortableJS

- Version: 1.15.6
- License: MIT
- Source: https://sortablejs.github.io/Sortable/ / https://github.com/SortableJS/Sortable
- Files: `js/sortable.esm.min.mjs` — the library's own modular ES-module build (`modular/sortable.esm.js` in the npm package), bundled and minified with `esbuild --bundle --minify --format=esm` (the upstream package ships that one build unminified only; no pre-minified ESM distribution exists upstream, unlike the pre-minified UMD `Sortable.min.js` this deliberately does NOT use — see the "why ESM" rationale below). Exports `default` (the `Sortable` class) plus the named `Sortable`/`MultiDrag`/`Swap` exports, unmodified from upstream other than the bundle/minify step itself — no vendored file's logic was hand-edited.

Acquired the same way as `../tabulator/`: `npm install sortablejs --no-save` temporarily (never added to `package.json`/committed as a real dependency), the ESM build minified via a one-off local `esbuild` invocation, then `npm uninstall sortablejs` once the single output file above was copied into this directory.

Vendored locally (not loaded from a CDN) deliberately, for the exact same reason as `../tabler/`/`../tabulator/`: this panel manages real consumer/business data — it should not depend on any external network request at runtime, and this app's CSP (`script-src 'self'`) would block a CDN `<script>` tag anyway.

The ESM build (not the UMD `Sortable.min.js` global-script build) was chosen for the same reason `../tabulator/NOTICE.md` already documents for its own `.mjs` choice: every panel-specific script in this codebase (`js/settings.js`, `js/userAccounts.js`, `js/categories.js`, etc.) is already loaded as `<script type="module">` and imports its dependencies via `import` — this matches that existing convention rather than introducing a second, inconsistent "global `<script>` + `window.Sortable`" loading style just for this one library.

Powers `js/categories.js`'s drag-and-drop category-tree reordering/re-parenting (category-tree follow-up, 2026-08-18) — the ONLY place in this admin panel that uses it so far.

No `.map` source-map file is vendored (mirrors `../tabler/`/`../tabulator/`'s own convention).
