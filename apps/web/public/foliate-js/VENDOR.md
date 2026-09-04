# Vendored: foliate-js

This is a pinned copy of [foliate-js](https://github.com/johnfactotum/foliate-js)
(MIT, John Factotum) — the reading engine for EPUB / MOBI / KF8 (AZW3) / FB2 / CBZ / PDF.
Plain text, single-file HTML, and `.cbr` comics are assembled app-side instead
(`features/reader/lib/text-book.ts`, `comic-archive.ts`) against the same book
contract `view.open()` accepts.

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
- **`fixed-layout.js` — local patch:** made the fixed-layout renderer honor
  ReadAware's `flow` and `max-column-count` attributes. `scrolled` uses a
  fit-width, single-page native scroller with bounded page crossing;
  `max-column-count=1` builds single-page spreads and `=2` builds paired
  spreads. The public `setLayout()` applies both values atomically before first
  navigation, avoiding WebKit custom-element reaction races, and a `rendered`
  event lets the app defer cover work until the visible PDF page is painted.
  This is what makes PDF scroll/single/double modes real rather than changing a
  setting that the upstream renderer ignores. Re-apply after any upstream update.
- **`pdf.js` / `fixed-layout.js` — page colors:** a PDF page is a canvas, so
  the reader's palette (which reaches reflowable books as injected CSS) had no
  way in and every fixed-layout book stayed on white paper inside a dark app.
  A light palette now goes in as `render({ background })`, which fills the
  canvas before the page is drawn — a lossless paper tint. A dark palette needs
  the page's tonal range remapped instead (black ink cannot be painted onto a
  dark sheet), and that is done with **composite operations**, not a filter.
  Every filter route fails on macOS WKWebView, each quietly: canvas `ctx.filter`
  does not run at all there (neither PDF.js's `render({ pageColors })` SVG
  filter nor shorthand functions), and the same filter on the canvas *element*
  via CSS runs until the canvas is large — scroll mode at fit-width times a
  Retina pixel ratio is past WebKit's filter-region limit, so the output comes
  back empty and the page disappears into the background color. All observed
  against the running desktop app. A pixel loop works everywhere but costs
  ~330ms on a 7.5-megapixel page; four composite fills (saturation → difference
  → multiply → lighter) land the same endpoints on the GPU.
  `FixedLayout.setPageColors()` holds the choice, threads it through `onZoom`,
  and invalidates each frame's cached scale so a palette change redraws. Policy
  (which form for which palette) lives in the app; the engine only does what it
  is told. Re-apply after any upstream update.
- **`fixed-layout.js` — annotation overlays:** the upstream renderer never
  creates an overlayer (`getContents()` carried a `TODO: index, overlayer`), so
  highlights, underlines, and notes were impossible on any fixed-layout book —
  PDFs included. Each frame now owns an overlay box that mirrors the iframe's
  geometry (mirroring its CSS scale, so ranges measured inside the iframe land
  on the right pixels), dispatches `create-overlayer`, and reports
  `{ doc, index, overlayer }` from `getContents()`. A lazily rendered page (PDF)
  gets its overlayer after the render, and re-renders — zoom, resize — rebuild
  it, because re-rendering discards the DOM the stored ranges pointed into.
  Re-apply after any upstream update.
- **`pdf.js` — text layer rebuild:** `TextLayer.render()` appends, and foliate
  re-renders on every zoom, so text layers stacked up: text selected twice over
  and, worse, the DOM shape a stored CFI was measured against stopped being
  reproducible. The text and annotation layers are now cleared before each
  render. Re-apply after any upstream update.
- **`view.js` — `relocate` carries the renderer's `reason`:** the paginator
  labels every relocation (`page`, `snap`, `scroll` for real navigation;
  `anchor` for a re-layout; `navigation` / `selection` for programmatic jumps),
  but `#onRelocate` consumed the label and emitted a bare location. Without it
  the app could only guess "did the reader move?" from a page/CFI delta — and a
  re-layout (soft keyboard, rotation, font-size change) moves the visible range
  too, so it read as a page turn and dismissed the reader chrome. The emitted
  detail now spreads `reason` alongside the location; `lastLocation` itself is
  left a pure location. Re-apply after any upstream update.
- **`view.js` / `overlayer.js` — independent render identity:** annotations may
  provide an `overlayKey` distinct from their CFI `value`, while hit testing
  still reports the CFI. This lets ReadAware's navigator focus layer coexist
  with a saved mark on the exact same sentence. Re-apply after any upstream
  update.
- **`fixed-layout.js` / `view.js` — continuous scroll, spread cache, and
  prerender:** upstream tore down every iframe on navigation (`#showSpread`
  began with `replaceChildren()`), so a PDF paid an iframe boot, a canvas
  raster, and a text layer on every page turn — and its "scrolled" flow was
  still one page at a time. Two rebuilt flows now share one frame model:
  - **Scrolled flow is a real continuous stack.** Every page owns a
    correctly-sized placeholder slot (arithmetically tracked — `offsetTop` is
    not dependable across a shadow boundary), so the scrollbar and jump
    targets are honest for the whole document; slots near the viewport hold
    live rendered frames (promote ~2.5 viewports ahead / 1.5 behind, demote
    beyond ~5/3), the reading position is derived from the scroll position
    (binary search, trailing-`setTimeout` throttled — never rAF, which
    WKWebView suspends entirely while the window is occluded), and
    `next()`/`prev()` scroll page-by-page.
  - **Paged flows keep a spread cache.** Frames stay alive per spread hidden
    via `visibility` (compositor layers survive, so revealing cannot flash),
    neighbors prerender after the visible page settles (ahead 2 / behind 1),
    and an LRU evicts beyond 10 live spreads. Books at or under 12 spreads
    render completely and stay resident — budgets sized against Retina-scale
    canvas memory (~12–17 MB per page).
  Contract changes: `load` is dispatched when a spread is SHOWN (paged;
  repeatedly for a cached document) or when a stack frame is created
  (scrolled), never by paged preloading — per-document listeners must dedupe.
  `view.js` guards its link handling/cursor autohide with a per-document
  WeakSet, replaces the overlayer hit-test click listener per document
  instead of stacking one per re-render, and the app's reader guards
  `attachDocListeners` the same way. `getContents()` returns the page being
  read first (consumers index `[0]`), followed by other live frames so
  annotation edits reach warm pages. Re-apply after any upstream update.
- **`pdf.js` — demand-driven data supply, cancellable renders, raster
  budget:** every PDF.js range request crosses the Tauri IPC bridge to a disk
  read, and PDF.js's HTTP-era defaults (64 KiB chunks + an eager background
  fetch of the entire file) turned a 175 MB scan into thousands of serialized
  bridge round-trips that starved the visible page's own fetches — the
  first page took >30 s to appear. `getDocument` now runs with
  `disableAutoFetch`, `disableStream`, and a 1 MiB `rangeChunkSize`
  (first page ≈ 0.9 s on the same book). `render()` accepts an
  `AbortSignal` (cancels the PDF.js render task and the text layer;
  throws a recognizable `RenderCancelledError`), and the raster scale is
  capped by a 12-megapixel canvas budget with the document transform
  generalized from `1/devicePixelRatio` to `zoom/rasterScale` — pixel-exact
  at normal window sizes, bounded on huge ones. The fixed-layout renderer's
  bookkeeping is success-based (a cancelled or failed render stays
  retryable; two strikes per scale stop a hopeless page from spinning), and
  its scrolled flow drains work through a single priority loop — nearest
  page first, re-picked after every await, renders of pages the reader
  scrolled away from cancelled — instead of restarting a chain per scroll
  tick. Creation races are settled explicitly: a stack page demoted while
  its iframe was still loading discards itself (never resurrects as an
  untracked orphan), and a paged spread evicted mid-creation re-registers.
  Re-apply after any upstream update.
- **`view.js` / `progress.js` — deferred, parallel TOC progress:** upstream's
  `TOCProgress.init` awaited `splitTOCHref` serially per flattened TOC entry,
  and `View.open` awaited both inits before creating the renderer. For PDFs
  each entry costs worker round-trips (`getDestination` + `getPageIndex`), so
  a 15 MB book with a large outline stalled for seconds before first paint.
  Entries now resolve in parallel (a failed entry drops out instead of
  failing the index), init runs off the open critical path, and once ready
  the last relocation is re-announced (reason `anchor`) so chapter labels
  and the TOC highlight fill themselves in. Re-apply after any upstream
  update.
- **`fixed-layout.js` — stack build without layout thrash:** sizing each of
  thousands of slots read `clientWidth` per slot (a forced reflow of an
  ever-growing flex container — O(n²): 9 s of a 3,246-page book's open time,
  measured) and appended them one by one. Batch passes read the width once
  and the build lands in a single `DocumentFragment` insertion (38 ms for
  the same book). Re-apply after any upstream update.
- **`pdf.js` — occlusion-proof cover extraction:** import-time PDF covers
  render with `intent: "print"`. Display-intent rendering paces itself with
  `requestAnimationFrame`, which WKWebView suspends entirely while the window
  is occluded — drag a batch of PDFs in and switch away, and every cover
  silently timed out against its 2.5 s budget, leaving the shelf coverless
  until each book's first open. Re-apply after any upstream update.
- **`paginator.js` — document-less views are a no-op:** `View.render()` and
  `View.expand()` return early when the iframe has no document. A typography
  attribute change (`max-inline-size` re-renders explicitly) or a resize that
  lands between two books — the previous view's iframe already torn down,
  the next not yet loaded — used to throw `null is not an object
  (evaluating 'doc.documentElement')` as an uncaught error; the load path
  renders the new document itself once it exists. Re-apply after any
  upstream update.
- **`mobi.js` — tolerant href resolution + `getSectionHref`:** `resolveHref` /
  `splitTOCHref` (MOBI 6 and KF8) return "unresolved" for hrefs that are not
  `filepos:` / `kindle:pos:` links instead of throwing `null is not an object`
  out of an async resolver — a synthesized or foreign TOC entry used to surface
  as an unhandled rejection per entry. Both book classes gain
  `getSectionHref(index)`, a navigable href for a section (a real `filepos`
  anchor inside it / its first fragment), which the app's TOC synthesis uses
  to add entries for books whose nav covers too little of the spine.
  Re-apply after any upstream update.
- Otherwise all engine modules and `vendor/` are byte-for-byte upstream.

## Updating

Re-clone upstream at the desired commit, copy the top-level `*.js` modules (minus the
demo/config) and `vendor/`, replace the PDF.js modern build with the same version's
official legacy build, include its `wasm/` assets, drop the `.map` files, and update
the pinned commit above.
