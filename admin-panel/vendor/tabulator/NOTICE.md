# Vendored: Tabulator (tabulator-tables)

- Version: 6.5.2
- License: MIT
- Source: https://tabulator.info / https://github.com/olifolkerd/tabulator
- Files: `css/tabulator.min.css` (the library's own default/"Standard" light theme — not a Bootstrap-specific variant, same "override via the library's own CSS custom properties" approach as `../tabler/NOTICE.md`), `js/tabulator_esm.min.mjs` (the ES-module "Full" build, exporting `TabulatorFull`, which bundles every built-in module — filtering, sorting, editing, movable columns, the column-header menu, persistence, etc. — this admin panel's Users grid actually uses) — pre-built distribution assets, copied as-is, not modified.

Acquired the same way as `../tabler/`: `npm install tabulator-tables` temporarily (never added to `package.json`/committed as a real dependency — installed with `--no-save`, then removed again via `npm uninstall` once the two files above were copied out of `node_modules/tabulator-tables/dist/`).

Vendored locally (not loaded from a CDN) deliberately, for the exact same reason as `../tabler/`: this panel now reads/writes real consumer `User` account data through this grid — it should not depend on any external network request at runtime. GoService's own color palette is applied via a small override stylesheet layered on top of this file (`../../css/tabulator-theme.css`), not by editing this vendored file directly, so it stays a clean drop-in replaceable by a future Tabulator version.

The `.mjs` build (not the UMD `tabulator.min.js` global-script build) was chosen specifically because every other panel-specific script in this codebase (`js/settings.js`, `js/userAccounts.js`, etc.) is already loaded as `<script type="module">` and imports its dependencies via `import` — matching that existing convention rather than introducing a second, inconsistent "global `<script>` + `window.Tabulator`" loading style just for this one library.

No `.map` source-map files are vendored (mirrors `../tabler/`'s own convention) — the minified files' own trailing `//# sourceMappingURL=...` comments will 404 harmlessly if a developer opens browser devtools with source maps enabled; this does not affect functionality.
