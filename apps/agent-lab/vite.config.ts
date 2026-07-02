import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Dev 便利：把 pi CLI（~/.pi/agent/auth.json）里的 api-key 凭证注入 lab，
 * 打开页面即可用，不用手动粘 key。只在 dev server 生效（localhost），
 * 这是本机开发工具，key 不会进任何构建产物。
 */
function readPiCliKeys(): Record<string, string> {
  try {
    const raw = readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf8");
    const auth = JSON.parse(raw) as Record<string, { type?: string; key?: string }>;
    const keys: Record<string, string> = {};
    for (const [provider, entry] of Object.entries(auth)) {
      if (entry?.type === "api_key" && entry.key) keys[provider] = entry.key;
    }
    return keys;
  } catch {
    return {};
  }
}

export default defineConfig(({ command }) => ({
  plugins: [tailwindcss(), react()],
  define: {
    __LAB_DEV_KEYS__: JSON.stringify(command === "serve" ? readPiCliKeys() : {}),
  },
  server: {
    // web 5173 / landing 5175 之外的独立端口
    port: 5176,
    strictPort: true,
  },
}));
