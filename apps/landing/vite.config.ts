import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";

// The app version this landing build advertises. Baked at build time from the
// desktop app's own config (same monorepo, bumped by every release commit), so
// download buttons can point at version-stamped release assets without any
// runtime lookup. A landing deployed behind the newest tag still works: the
// older tag's assets stay downloadable forever, and the app self-updates.
const { version: appVersion } = JSON.parse(
  readFileSync(new URL("../desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig(({ isSsrBuild }) => ({
  define: {
    __READAWARE_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    tailwindcss(),
    // Router plugin must run before the React plugin so generated routes are transformed.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
  ],
  build: {
    // The SSR pass only produces the prerender entry (scripts/prerender.mjs);
    // static assets already live in the client dist/.
    copyPublicDir: !isSsrBuild,
  },
  server: {
    // Distinct from the web app (5173) so both can run side by side.
    port: 5175,
    strictPort: true,
  },
}));
