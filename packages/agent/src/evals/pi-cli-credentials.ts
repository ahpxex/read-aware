/**
 * eval/dev 链路的凭证仓：直接落 pi CLI 自己的 ~/.pi/agent/auth.json。
 * pi-ai 的 Credential 类型就是这个文件的条目形状（"the shape of today's
 * auth.json"），零转换——把它挂进 registry 后，OAuth 订阅（openai-codex
 * 等）的过期刷新与回写由 pi-ai 的 resolveStoredOAuth 自动完成（双重检查
 * 锁，refresh 后写回文件，pi CLI 那边同样受益）。api-key provider 不受
 * 影响：eval 链路始终显式传 apiKey override，优先于仓里的条目。
 *
 * 写回是进程内串行、跨进程无锁——与同时活跃的 pi CLI 并发刷新理论上会
 * 互相覆盖，但 refresh 以小时计且两边写的是同一份新 token，实害可忽略。
 * 仅限 eval/脚本使用（node:fs）；产品运行时不得 import（产品凭证走
 * LlmAccount，doc §8）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

function readAll(): Record<string, Credential> {
  try {
    return JSON.parse(readFileSync(AUTH_PATH, "utf8")) as Record<string, Credential>;
  } catch {
    return {};
  }
}

export class PiCliCredentialStore implements CredentialStore {
  /** modify 的进程内串行链（每 provider 一条）。 */
  private chains = new Map<string, Promise<unknown>>();

  private enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const next = (this.chains.get(providerId) ?? Promise.resolve()).then(task, task);
    this.chains.set(providerId, next);
    return next;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return readAll()[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(readAll()).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      const all = readAll();
      const next = await fn(all[providerId]);
      if (next === undefined) return all[providerId];
      all[providerId] = next;
      writeFileSync(AUTH_PATH, `${JSON.stringify(all, null, 2)}\n`, "utf8");
      return next;
    });
  }

  async delete(providerId: string): Promise<void> {
    await this.enqueue(providerId, async () => {
      const all = readAll();
      if (!(providerId in all)) return;
      delete all[providerId];
      writeFileSync(AUTH_PATH, `${JSON.stringify(all, null, 2)}\n`, "utf8");
    });
  }
}
