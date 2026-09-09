import { expect, test } from "bun:test";

if (process.env.ROAMING_SECRET_DURABILITY === "1") {
  const disk = new Map<string, string>();
  const events: { payload: { key: string; value: { sealed: string } | null } }[] = [];
  const pending: { key: string; resolve(): void; reject(error: unknown): void }[] = [];
  const commands: string[] = [];
  let hold = false;
  let rows: { key: string; valueJson: string }[] = [];
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    invoke: (command: string, args: { key: string; value: string; events: typeof events }) => {
      commands.push(command);
      if (command === "secret_keys") return Promise.resolve([]);
      if (command === "local_device_get") return Promise.resolve({ deviceId: "secret-proof", lastHlcWallMs: null, lastHlcCounter: null });
      if (command === "preferences_load_all") return Promise.resolve(rows);
      if (command === "commit_events") { events.push(...args.events); return Promise.resolve({ appended: args.events.length, applied: args.events.length }); }
      if (command === "secret_set" || command === "secret_delete") {
        return new Promise<void>((resolve, reject) => {
          const commit = () => { if (command === "secret_delete") disk.delete(args.key); else disk.set(args.key, args.value); resolve(); };
          if (hold) pending.push({ key: args.key, resolve: commit, reject }); else commit();
        });
      }
      return Promise.resolve();
    },
  } } });
  const secrets = await import("./secret-store");
  const roaming = await import("./roaming-preferences");
  const { saveAIConfig } = await import("../features/ai/lib/ai-config");
  const { onAppEvent } = await import("./app-events");
  const { toBase64, sealSecret, openSecret } = await import("./sync-envelope");
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const key = new Uint8Array(32).fill(7);
  const slot = "ai-api-key.openai";
  const secretEvents = () => events.filter(event => event.payload.key === `secret:${slot}`);
  const decoded = () => secretEvents().map(event => event.payload.value === null ? null : openSecret(key, slot, event.payload.value.sealed));

  test("only durable local credential values roam; rollback, remote overlays and catch-up honor that boundary", async () => {
    await secrets.hydrateSecrets();
    await secrets.setSecretAsync("sync.master-key", toBase64(key));
    hold = true;
    saveAIConfig({ provider: "openai", apiKey: "synthetic-rejected", model: "test" });
    await tick(); expect(secretEvents()).toHaveLength(0);
    pending.shift()!.reject({ code: "fs/permission-denied", message: "synthetic failure" });
    await secrets.afterSecretWrites(() => {}); await tick();
    expect(decoded()).toEqual([]); expect(disk.has(slot)).toBe(false);

    secrets.setSecret(slot, "synthetic-first");
    secrets.setSecret(slot, "synthetic-later");
    await tick(); expect(secrets.getSecret(slot)).toBe("synthetic-later");
    pending.shift()!.resolve(); await tick();
    expect(decoded()).toEqual(["synthetic-first"]);
    expect(secrets.getDurableSecret(slot)).toBe("synthetic-first");
    pending.shift()!.reject({ code: "fs/permission-denied" });
    await secrets.afterSecretWrites(() => {});
    expect(secrets.getSecret(slot)).toBe("synthetic-first");
    expect(decoded()).toEqual(["synthetic-first"]);

    secrets.deleteSecret(slot); await tick();
    pending.shift()!.reject({ code: "fs/permission-denied" });
    await secrets.afterSecretWrites(() => {}); expect(decoded()).toEqual(["synthetic-first"]);
    secrets.deleteSecret(slot); await tick(); pending.shift()!.resolve(); await tick();
    expect(decoded()).toEqual(["synthetic-first", null]);

    const changed: string[][] = [];
    const stop = onAppEvent("roaming-preferences-changed", event => changed.push(event.keys));
    rows = [{ key: `secret:${slot}`, valueJson: JSON.stringify({ sealed: sealSecret(key, slot, "synthetic-remote") }) }];
    let finished = false;
    const refresh = roaming.refreshRoamingPreferences().then(() => { finished = true; });
    await tick(); expect(finished).toBe(false); expect(changed).toEqual([]);
    pending.shift()!.reject({ code: "fs/permission-denied" }); await refresh;
    expect(changed).toEqual([]); expect(secrets.getSecret(slot)).toBe("");
    const recovery = roaming.refreshRoamingPreferences(); await tick(); pending.shift()!.resolve(); await recovery;
    expect(changed).toEqual([[`secret:${slot}`]]);
    expect(decoded()).toEqual(["synthetic-first", null]);
    expect(disk.get(slot)).toBe("synthetic-remote"); stop();

    secrets.setSecret(slot, "synthetic-pending");
    const catchup = roaming.republishRoamingSecrets(); await tick();
    expect(decoded()).toEqual(["synthetic-first", null]);
    pending.shift()!.reject({ code: "fs/permission-denied" }); await catchup; await tick();
    expect(decoded()).toEqual(["synthetic-first", null, "synthetic-remote"]);

    secrets.setSecret(slot, "synthetic-old-master");
    secrets.setSecret("sync.master-key", toBase64(new Uint8Array(32).fill(8)));
    await tick(); pending.shift()!.resolve(); await tick();
    expect(decoded().at(-1)).toBe("synthetic-old-master");
    pending.shift()!.reject({ code: "fs/permission-denied" }); await secrets.afterSecretWrites(() => {});
    expect(JSON.stringify(events)).not.toContain("synthetic-");
    expect(events.some(event => event.payload.key.startsWith("secret:sync."))).toBe(false);
    expect(pending).toHaveLength(0);
  });

  test("each remote row waits for newly queued local writes before comparing values", async () => {
    const second = "ai-api-key.anthropic";
    hold = false;
    await secrets.setSecretAsync(second, "synthetic-before", "remote");
    rows = [
      { key: `secret:${slot}`, valueJson: JSON.stringify({ sealed: sealSecret(key, slot, "synthetic-overlay-first") }) },
      { key: `secret:${second}`, valueJson: JSON.stringify({ sealed: sealSecret(key, second, "synthetic-overlay-second") }) },
    ];
    hold = true;
    const refresh = roaming.refreshRoamingPreferences();
    await tick(); expect(pending[0].key).toBe(slot);
    secrets.setSecret(second, "synthetic-overlay-second");
    pending.shift()!.resolve(); await tick();
    expect(pending[0].key).toBe(second);
    pending.shift()!.reject({ code: "fs/permission-denied" }); await tick();
    expect(pending[0]?.key).toBe(second);
    pending.shift()!.resolve(); await refresh;
    expect(disk.get(second)).toBe("synthetic-overlay-second");
    expect(events.filter(event => event.payload.key === `secret:${second}`)).toHaveLength(0);
  });

  test("failed connection credentials prevent account adoption and sync activation", async () => {
    const { persistConnection, persistTransportConnection } = await import("./sync/sync-scheduler");
    for (const connect of [
      () => persistConnection({ session: "synthetic-session", accountId: "synthetic-account", masterKeyBase64: toBase64(key) }),
      () => persistTransportConnection({ ref: "synthetic-ref", endpointId: "synthetic-endpoint", masterKeyBase64: toBase64(key) }),
    ]) {
      commands.length = 0; hold = true;
      const result = connect().catch(error => error);
      await tick(); pending.shift()!.reject({ code: "fs/permission-denied" });
      expect((await result).code).toBe("fs/permission-denied");
      expect(commands.filter(command => !command.startsWith("plugin:log|"))).toEqual(["secret_set"]);
      expect(pending).toHaveLength(0);
    }
  });
} else {
  test("isolated credential publication durability", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, ROAMING_SECRET_DURABILITY: "1" }, stdout: "ignore", stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("3 pass");
  }, 30_000);
}
