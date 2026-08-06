import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild }) => ({
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
