/**
 * 开发脚本（spike / demo）专用的 key 解析：读 pi CLI 自己的 ~/.pi/agent/auth.json。
 * 产品运行时不允许 import 这个模块 —— 产品的凭证走 LlmAccount（doc §8）。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function readPiCliKey(provider: string): string | undefined {
  let entry: { type?: string; key?: string; access?: string; expires?: number } | undefined;
  try {
    const raw = readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf8");
    const auth = JSON.parse(raw) as Record<string, typeof entry>;
    entry = auth[provider];
  } catch {
    return undefined;
  }
  if (entry?.type === "api_key") return entry.key;
  // OAuth 订阅（如 openai-codex）：返回 access 仅作"已登录"的存在性证明。
  // 真正的请求鉴权走挂了 PiCliCredentialStore 的 registry——pi-ai 在那里
  // 自动刷新过期 token 并回写 auth.json，这里不做过期判断。
  if (entry?.type === "oauth" && entry.access) return entry.access;
  return undefined;
}
