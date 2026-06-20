// Runtime bridge for the app. The vendored foliate-js modules are served
// statically from this folder and must not be imported from app source (Vite
// rejects importing `public/` files, and bundling would break foliate's
// `import.meta.url` asset resolution). The app injects this file as an external
// `<script type="module" src>` tag — the browser evaluates it natively, its
// relative imports resolve here under `/foliate-js/`, and it registers the
// `<foliate-view>` custom element (side effect of importing view.js) and hangs
// the entry points off the global for the app to pick up.
import { makeBook } from "./view.js";
import { Overlayer } from "./overlayer.js";

globalThis.__readawareFoliate = { makeBook, Overlayer };
