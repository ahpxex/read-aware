/**
 * 开发脚本（spike / demo）专用的 key 解析：读 pi CLI 自己的 ~/.pi/agent/auth.json。
 * 产品运行时不允许 import 这个模块 —— 产品的凭证走 LlmAccount（doc §8）。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function readPiCliKey(provider: string): string | undefined {
  try {
    const raw = readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf8");
    const auth = JSON.parse(raw) as Record<string, { type?: string; key?: string }>;
    const entry = auth[provider];
    return entry?.type === "api_key" ? entry.key : undefined;
  } catch {
    return undefined;
  }
}
