import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const isStorybook = process.argv.some((arg) => arg.includes("storybook"));

export default defineConfig({
  plugins: [
    tailwindcss(),
    !isStorybook && tanstackStart({ srcDirectory: "src" }),
    react(),
    !isStorybook && nitro(),
  ].filter(Boolean),
});
