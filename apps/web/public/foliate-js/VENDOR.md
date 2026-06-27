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
demo/config) and `vendor/`, drop the `.map` files, and update the pinned commit above.
