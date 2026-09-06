# Foliate Engine Maintenance

`src/` is the canonical TypeScript engine. `../public/foliate-js/*.js` is its
Git-ignored, generated runtime, not a second source tree. The engine is loaded
as native ES modules inside Tauri; application imports of engine contracts
must be type-only. The original pin, license, third-party assets, and local
behavior changes are documented in `../public/foliate-js/VENDOR.md`.

## Build Invariants

From `apps/web`:

- `bun run build:foliate` checks strict types and the no-any policy, emits
  changed modules, and removes orphaned generated top-level modules.
- `bun run check:foliate` checks strict source types and the no-any policy
  without reading or writing generated modules. It is part of `typecheck`
  and works before the first build in a fresh checkout.
- `bun run watch:foliate` repeats the checked build when sources change.
  Both `dev` and `storybook` perform an initial build and supervise this
  watcher together with their frontend server.
- `bun run test` builds the engine before running unit tests.

Only TypeScript sources, build scripts, documentation, licenses, and upstream
`vendor/` assets are tracked. Dev, tests, production, and Storybook builds emit
the runtime first; Turbo also caches the generated modules with their producing
tasks. A clean checkout does not need a manually committed runtime snapshot.

The additional compiler-API check rejects explicit `any`, inferred binding
and return types containing `any` (including collection/iterator defaults and
Promise rejection callbacks), double assertions through `unknown`, and TS
suppression comments. External data is narrowed from `unknown`; real SDK and
DOM boundaries retain concrete declarations. This is not a ban on legitimate
type guards or schema-preserving assertions.

`vendor/` remains upstream distribution code. PDF.js declarations are pinned
to the exact vendored version; zip.js, fflate, fonts, CMaps, and WASM are not
transpiled or bundled. Generated static paths and `import.meta.url` asset
resolution are public runtime contracts.

## Ownership And Boundaries

- `book.ts`, `renderer.ts`, and `engine-api.ts` define shared contracts.
  The application wrapper re-exports those types rather than approximating
  synchronous APIs or hiding them behind unknown arrays.
- EPUB package resources, metadata, navigation, loading, and media playback
  are separate modules. MOBI binary parsing, MOBI6 sections, and KF8 assembly
  are likewise separated.
- A View owns books it parses from a file or URL. A caller-supplied Book is
  borrowed, which lets footnote views share it without destroying the reader.
- Application readers and background extraction retain explicit book leases;
  the last owner releases the parser. Closing a view stops playback, aborts
  document listeners, cancels stale work, and releases its renderer sections.
- Href resolution may be asynchronous. Chapter marks resolve in parallel off
  the first-page critical path; stale work cannot update a replacement book.

## Validation

Unit tests cover CFI boundaries, search/TTS text ranges, metadata, archive
resources, decompression, navigation, ownership, and the type gate. Fixtures
under `tests/fixtures/` include deterministic EPUB, FB2, PDF, MOBI6/PalmDOC,
and KF8 documents.

`tests/runtime/foliate-*-regressions.ts` must run inside the foreground Tauri
webview, not a plain browser. They exercise native iframe layout, vertical/RTL
pagination, fixed pages, PDF canvas pixels and palette redraws, images, CFI
restoration, footnotes, media highlighting, and close/navigation races. Load
the emitted modules from `/foliate-js/` using the Tauri bridge, then pass those
module objects to the suites. Importing public modules from Vite source would
rewrite their URLs, so the suites use type-only engine imports.

Repository EPUB samples additionally exercise real ZIP books. Larger external
MOBI/AZW3 samples may be supplied to `runMOBIRegressions` as File objects; they
are not required or downloaded by unit tests.

For a release, also run the workspace tests/typecheck and `bun run build:desktop`.
A successful frontend build is not packaged CSP or signing verification.
