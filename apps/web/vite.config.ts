import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";

const isStorybook = process.argv.some((arg) => arg.includes("storybook"));

// Set by the Tauri CLI during `tauri android/ios dev`: the host machine's LAN
// address, so the webview on the device/emulator can reach this dev server.
const tauriDevHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [
    tailwindcss(),
    // Router plugin must run before the React plugin so generated routes are transformed.
    // autoCodeSplitting stays OFF: this is a single-route app, so a per-route
    // chunk only adds a boot roundtrip (and a flash of pending UI) — heavy
    // surfaces are split at the component level in App.tsx instead.
    !isStorybook && tanstackRouter({ target: "react", autoCodeSplitting: false }),
    react(),
  ].filter(Boolean),
  server: {
    // Fixed port so the Tauri desktop shell can point its devUrl here.
    port: 5173,
    strictPort: true,
    // Mobile dev: expose the server on the LAN and pin HMR to the host address
    // (the default HMR endpoint would resolve to the device itself).
    host: tauriDevHost || false,
    hmr: tauriDevHost
      ? { protocol: "ws", host: tauriDevHost, port: 5174 }
      : undefined,
  },
});
