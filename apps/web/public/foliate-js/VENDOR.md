# Vendored: foliate-js

This is a pinned copy of [foliate-js](https://github.com/johnfactotum/foliate-js)
(MIT, John Factotum) — the reading engine for EPUB / MOBI / KF8 (AZW3) / FB2 / CBZ / PDF.

- **Source:** https://github.com/johnfactotum/foliate-js
- **Pinned commit:** `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01)
- **License:** MIT (see `LICENSE`)

## Why it lives in `public/` (served, not bundled)

foliate-js resolves its lazily-loaded parsers and PDF.js assets at **runtime** via
relative paths and `new URL(..., import.meta.url)` (see `pdf.js`). Letting Vite bundle
it would rewrite `import.meta.url` and break asset resolution (PDF worker, cmaps, fonts).
Serving the tree statically and importing it at runtime (`import("/foliate-js/view.js")`)
keeps every relative path correct in dev, production, and the Tauri webview, and keeps
the ~5.6 MB engine out of the JS bundle (only the modules for the opened format load).

The typed wrapper that consumes this lives at
`apps/web/src/features/reader/lib/foliate-engine.ts`.

## What was changed from upstream

- Removed the demo (`reader.js`, `reader.html`, `ui/`), tests, and build/lint config.
- Removed `vendor/pdfjs/*.map` sourcemaps (~7.4 MB, runtime-unneeded).
- **PDF.js compatibility patch:** replaced PDF.js 5.5.207's modern
  `build/pdf*.mjs` files with the matching official `legacy/build/pdf*.mjs`
  files. The modern build requires JavaScript APIs that are not yet available
  in Tauri's macOS WKWebView (notably `Map.prototype.getOrInsertComputed`),
  while Mozilla's legacy build exposes the same API with its supported
  compatibility layer. Also vendored PDF.js's `wasm/` assets and configured
  `wasmUrl` in `pdf.js` so image decoders do not depend on missing runtime
  files. Re-apply both changes after any upstream update.
- **`pdf.js` — local PDF experience patches:** each page section exposes a
  lightweight `getText()` path for on-device AI/search extraction without
  rendering a canvas; page ids are stable `page:N` locators; cover generation
  reuses already-rendered reader canvases, otherwise renders bounded thumbnails
  under a fixed time budget, and skips up to four blank leading leaves. The
  existing PDF.js range transport is intentionally preserved so desktop can
  feed it native file slices instead of copying an entire large PDF into the
  webview. Re-apply these changes after any upstream update.
- **`paginator.js` — local patch:** added `#container::-webkit-scrollbar*` rules
  to the paginator's (closed) shadow-root `<style>` so the scroll-mode scrollbar
  matches the app's hairline style. The scroller is sealed in a `mode: 'closed'`
  shadow root, so app-level CSS cannot reach it and forcing the root open would
  need a brittle global `attachShadow` monkey-patch; styling it at the source is
  the clean fix. The rules read the app's `--ra-scrollbar-*` tokens (which
  inherit across the shadow boundary) with standalone fallbacks. Re-apply this
  after any upstream update.
- Otherwise all engine modules and `vendor/` are byte-for-byte upstream.

## Updating

Re-clone upstream at the desired commit, copy the top-level `*.js` modules (minus the
demo/config) and `vendor/`, replace the PDF.js modern build with the same version's
official legacy build, include its `wasm/` assets, drop the `.map` files, and update
the pinned commit above.
