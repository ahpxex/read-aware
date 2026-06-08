import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";

const isStorybook = process.argv.some((arg) => arg.includes("storybook"));

export default defineConfig({
  plugins: [
    tailwindcss(),
    // Router plugin must run before the React plugin so generated routes are transformed.
    !isStorybook && tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
  ].filter(Boolean),
  server: {
    // Fixed port so the Tauri desktop shell can point its devUrl here.
    port: 5173,
    strictPort: true,
  },
});
