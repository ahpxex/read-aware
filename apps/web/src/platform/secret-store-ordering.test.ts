import { expect, test } from "bun:test";
import { afterSecretWrites, deleteSecret, getSecret, hydrateSecrets, onSecretCommit, setSecret } from "./secret-store";
import { afterSettingsWrites } from "../domain/settings/observation-sources";
import { localKV } from "./local-store";

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
if (process.env.SECRET_ORDERING_CASE === "1") {
  const pending: { command: string; resolve(): void; reject(error: unknown): void }[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    invoke: (command: string) => {
      if (command === "secret_keys") return Promise.resolve([]);
      if (command === "secret_set" || command === "secret_delete" || command === "set_kv") {
        return new Promise<void>((resolve, reject) => pending.push({ command, resolve, reject }));
      }
      return Promise.resolve();
    },
  } } });
  test("credential writes preserve newer optimism, roll back failures, and expose only committed slot notifications", async () => {
    await hydrateSecrets(); const seen: unknown[] = [];
    const stop = onSecretCommit((key, source) => seen.push({ key, source }));
    setSecret("ai-api-key.test", "synthetic-first");
    setSecret("ai-api-key.test", "synthetic-next", "remote");
    expect(getSecret("ai-api-key.test")).toBe("synthetic-next");
    await tick(); expect(pending).toHaveLength(1); pending.shift()!.reject({ code: "db/locked" });
    await tick(); expect(getSecret("ai-api-key.test")).toBe("synthetic-next"); expect(seen).toEqual([]);
    pending.shift()!.resolve(); await afterSecretWrites(() => {});
    expect(seen).toEqual([{ key: "ai-api-key.test", source: "remote" }]);
    deleteSecret("ai-api-key.test"); await tick(); pending.shift()!.reject({ code: "db/locked" });
    await afterSecretWrites(() => {}); expect(getSecret("ai-api-key.test")).toBe("synthetic-next");
    expect(JSON.stringify(seen)).not.toContain("synthetic"); stop();
  });
  test("settings barrier rechecks KV writes accepted while a credential write was pending", async () => {
    setSecret("ai-api-key.test", "synthetic-latest");
    let sampled = false;
    const read = afterSettingsWrites(() => { sampled = true; return localKV.getItem("test-setting"); });
    await tick(); expect(sampled).toBe(false);
    const kv = localKV.setItemAsync("test-setting", "later");
    await tick(); const secret = pending.findIndex(item => item.command === "secret_set");
    pending.splice(secret, 1)[0].resolve(); await tick(); expect(sampled).toBe(false);
    pending.shift()!.resolve(); await kv; expect(await read).toBe("later");
  });
} else {
  test("isolated native credential ordering and settings barrier", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, SECRET_ORDERING_CASE: "1" }, stdout: "ignore", stderr: "pipe" });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0); expect(output).toContain("2 pass");
  }, 30_000);
}
