import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    // Router plugin must run before the React plugin so generated routes are transformed.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
  ],
  server: {
    // Distinct from the web app (5173) so both can run side by side.
    port: 5175,
    strictPort: true,
  },
});
