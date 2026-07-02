/**
 * 独立跑 Phase 0 spike：在 packages/agent 下 `bun run spike [provider] [model]`。
 * key 解析顺序：`<PROVIDER>_API_KEY` 环境变量 → pi CLI 自己的 ~/.pi/agent/auth.json。
 * spike 结论落地后随 spike.ts 一起删除。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runPiSpike, type SpikeConfig } from "./spike";

const ENV_KEYS: Record<SpikeConfig["provider"], string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "zai-coding-cn": "ZAI_CODING_CN_API_KEY",
};

const DEFAULT_MODELS: Record<SpikeConfig["provider"], string> = {
  anthropic: "claude-3-5-haiku-20241022",
  openai: "gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini",
  "zai-coding-cn": "glm-5-turbo",
};

function readPiCliKey(provider: string): string | undefined {
  try {
    const raw = readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf8");
    const auth = JSON.parse(raw) as Record<string, { type?: string; key?: string }>;
    const entry = auth[provider];
    return entry?.type === "api_key" ? entry.key : undefined;
  } catch {
    return undefined;
  }
}

const provider = (process.argv[2] ?? "zai-coding-cn") as SpikeConfig["provider"];
if (!(provider in ENV_KEYS)) {
  console.error(`unknown provider "${provider}" — one of: ${Object.keys(ENV_KEYS).join(", ")}`);
  process.exit(1);
}
const model = process.argv[3] ?? DEFAULT_MODELS[provider];
const apiKey = process.env[ENV_KEYS[provider]] ?? readPiCliKey(provider) ?? "";
if (!apiKey) {
  console.error(`no API key for ${provider}: set ${ENV_KEYS[provider]} or log in via pi CLI`);
  process.exit(1);
}

const report = await runPiSpike({ provider, apiKey, model });
console.log("\n=== SPIKE REPORT ===");
console.log(JSON.stringify(report, null, 2));
