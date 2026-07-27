# Vendored: libarchive.js (RAR decoding)

The WASM half of [libarchive.js](https://github.com/nika-begiashvili/libarchivejs)
(MIT), a port of [libarchive](https://github.com/libarchive/libarchive) (BSD-2).
It exists for one format: `.cbr` comic archives. Everything else the app reads
is handled by the vendored reading engine or by the app itself.

- **Package:** `libarchive.js@2.0.2` (a normal dependency; only these two build
  artifacts are copied here)
- **Files:** `worker-bundle.js` (the worker; resolves `libarchive.wasm`
  relative to itself) and `libarchive.wasm`
- **License:** MIT (`LICENSE`), over BSD-2-licensed libarchive

## Why these two files live in `public/`

The ES-module half (`Archive`) is imported normally and bundled; the worker
bundle is not, because it is already bundled and locates its `.wasm` sibling at
runtime through `import.meta.url`. Letting Vite rewrite that would break the
lookup, so both files are served statically and the worker URL is passed to
`Archive.init()` — the same arrangement as `public/foliate-js`.

The consumer is `apps/web/src/features/reader/lib/comic-archive.ts`, which is
imported lazily: the ~1 MB WASM payload only loads when a `.cbr` is opened.

## Notes for the next update

- `getFilesArray()` returns an empty array for archives whose entries sit at the
  root — which is how comics are packed. The entry tree comes from
  `getFilesObject()` instead.
- The `CompressedFile` instances that tree is documented to contain do not
  survive the worker boundary here (they arrive as bare objects with no
  `extract`), so page bytes are read back with `archive.extractSingleFile(path)`.
- Instantiating WASM under the packaged app's CSP requires `'wasm-unsafe-eval'`
  in `script-src` (see `apps/desktop/src-tauri/tauri.conf.json`).

## Why not DjVu

The only maintained JavaScript DjVu decoder (DjVu.js) is **GPL v2** — inherited
from DjVuLibre, whose code its codecs are derived from. Linking it into
ReadAware would put the whole app under GPL, so DjVu stays unsupported. This is
a licensing constraint, not an engineering one.
