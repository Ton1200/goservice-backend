# Vendored: Tabler (@tabler/core)

- Version: 1.4.0
- License: MIT
- Source: https://tabler.io / https://github.com/tabler/tabler
- Files: `css/tabler.min.css`, `js/tabler.min.js` — pre-built distribution assets, copied as-is, not modified.

Vendored locally (not loaded from a CDN) deliberately: this panel manages feature
flags and, in later slices, encrypted third-party credentials — it should not
depend on any external network request at runtime. GoService's own color
palette is applied via a small override stylesheet layered on top of this file
(`../css/admin-theme.css`), not by editing this vendored file directly, so it
stays a clean drop-in replaceable by a future Tabler version.
