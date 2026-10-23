import { expect, test } from "bun:test";

if (process.env.BACKUP_DOMAIN_PROOF === "1") {
  type Pending = { command: string; args: any; resolve(value?: unknown): void; reject(error: unknown): void };
  const pending: Pending[] = [],
    calls: string[] = [];
  const holds = new Set<string>();
  const credentialObligations = new Set<string>();
  const summary: string | null = "before";
  const revision = `profile2:${"a".repeat(64)}`;
  const native = async (command: string, args: any): Promise<unknown> => {
    calls.push(command);
    if (holds.has(command))
      return new Promise((resolve, reject) =>
        pending.push({
          command,
          args,
          resolve: (value) => {
            if (
              command === "secret_set" &&
              args?.roam !== false &&
              typeof args?.key === "string" &&
              args.key.startsWith("ai-api-key")
            )
              credentialObligations.add(args.key);
            if (command === "restored_credentials_publish") {
              for (const event of args?.events ?? []) {
                const key = event?.payload?.key;
                if (typeof key === "string" && key.startsWith("secret:"))
                  credentialObligations.delete(key.slice("secret:".length));
              }
            }
            resolve(value);
          },
          reject,
        }),
      );
    if (command === "local_device_get") return { deviceId: "domain-proof", lastHlcWallMs: null, lastHlcCounter: null };
    if (command === "profile_initialize") return { migrated: false, snapshot: { summary, revision } };
    if (command === "profile_inspect") return { summary, revision };
    if (command === "commit_events") return { appended: args.events.length, applied: args.events.length };
    if (command === "restored_credentials_pending") return [...credentialObligations];
    if (["secret_keys", "reading_sessions_pending"].includes(command)) return [];
    if (command === "backup_close_reading_sessions") return [];
    if (command === "backup_export_choose_destination") return "/synthetic/backup.age";
    if (command === "backup_export_sources") return [];
    if (command === "backup_export_capture") return { taskId: args.taskId, format: 2 };
    if (command === "backup_export_write") return true;
    return undefined;
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_INTERNALS__: { invoke: native, transformCallback: () => 1 } },
  });
  const { withDomainBackup } = await import("./domain-write-gate");
  const events = await import("./domain-events");
  const kv = await import("./local-store");
  const secrets = await import("./secret-store");
  await import("./roaming-preferences");
  const { decideEntity } = await import("../domain/entity-registry");
  const { mutateMemory } = await import("../domain/memory-management");
  const { changeBookClassification } = await import("../domain/book-classification");
  const { saveBookDigest } = await import("../domain/book-digest");
  const { commitAnnotationMutations } = await import("../features/annotations/lib/annotation-mutations");
  const { exportFullBackup } = await import("../features/settings/lib/full-backup-export");
  const { applyFullBackup } = await import("../features/settings/lib/full-backup-apply");
  const { durableWrites } = await import("./write-settlement");
  const { onAppEvent } = await import("./app-events");
  const tick = () => Bun.sleep(0);
  const take = (command: string) => {
    const index = pending.findIndex((item) => item.command === command);
    expect(index).toBeGreaterThanOrEqual(0);
    return pending.splice(index, 1)[0]!;
  };

  test("domain backup drains actual KV/secret publication tails and delayed envelope preparation", async () => {
    await secrets.hydrateSecrets();
    await secrets.setSecretAsync("sync.master-key", btoa(String.fromCharCode(...new Uint8Array(32).fill(17))));
    holds.add("set_kv_batch");
    holds.add("secret_set");
    holds.add("local_device_get");
    holds.add("restored_credentials_publish");
    const setting = kv.localKV.setItemAsync("read-aware-app-settings", '{"theme":"dark"}');
    const secret = secrets.setSecretAsync("ai-api-key.proof", "synthetic");
    expect(kv.localKV.getItem("read-aware-app-settings")).toBe('{"theme":"dark"}');
    expect(secrets.getSecret("ai-api-key.proof")).toBe("synthetic");
    let captured = false;
    const backup = withDomainBackup(async () => {
      captured = true;
    });
    await tick();
    take("secret_set").resolve();
    await secret;
    await tick();
    expect(captured).toBe(false);
    // The roaming setting waits for its event envelope, then commits KV and
    // event in one native write; the credential waits for its own envelope.
    const deviceReads = [take("local_device_get"), take("local_device_get")];
    for (const read of deviceReads)
      read.resolve({ deviceId: "domain-proof", lastHlcWallMs: null, lastHlcCounter: null });
    await tick();
    expect(captured).toBe(false);
    const write = take("set_kv_batch");
    expect(JSON.stringify(write.args)).not.toContain("synthetic");
    expect(write.args.events.map((event: any) => event.type)).toEqual(["preference.changed"]);
    write.resolve();
    await setting;
    await tick();
    expect(captured).toBe(false);
    const publication = take("restored_credentials_publish");
    expect(JSON.stringify(publication.args)).not.toContain("synthetic");
    publication.resolve({ events: publication.args.events, awaitingConnection: false });
    await backup;
    expect(captured).toBe(true);
    expect(durableWrites.size).toBe(0);
    holds.clear();
  });

  test("an accepted conditional transaction keeps its cancelled owner's real receipt and observer tail", async () => {
    const controller = new AbortController();
    holds.add("entity_commit");
    holds.add("commit_events");
    let tail: Promise<unknown> | undefined;
    const stop = events.onDomainEventBroadcast((event) => {
      if (event.type === "entity.resolved")
        tail = events.commitDomainEvents({ type: "book.starred", payload: { bookId: "b", starred: true } });
    });
    const write = decideEntity(
      {
        op: "resolve",
        entityId: "e",
        kind: "person",
        canonicalName: "Name",
        expectedRevision: `entities1:${"a".repeat(64)}`,
      },
      "plugin:writer",
      controller.signal,
    );
    await tick();
    const nativeWrite = take("entity_commit");
    let captured = false;
    const backup = withDomainBackup(async () => {
      captured = true;
    });
    controller.abort();
    await tick();
    expect(captured).toBe(false);
    nativeWrite.resolve({ changed: true, revision: "next", persistence: "event-log" });
    expect(await write).toMatchObject({ changed: true });
    await tick();
    expect(captured).toBe(false);
    take("commit_events").resolve({ appended: 1, applied: 1 });
    await tail;
    await backup;
    expect(captured).toBe(true);
    stop();
    holds.clear();
  });

  test("actual export rejects every event actor and conditional domain writes before mint or IPC", async () => {
    holds.add("backup_export_capture");
    const failures: unknown[] = [],
      off = onAppEvent("local-write-failed", (value) => failures.push(value));
    let settingMirror = kv.localKV.getItem("read-aware-app-settings");
    const stopMirror = kv.onLocalKVChange((key, value) => {
      if (key === "read-aware-app-settings") settingMirror = value;
    });
    const backup = exportFullBackup("a synthetic backup password");
    let capture: Pending | undefined;
    try {
      while (!pending.some((item) => item.command === "backup_export_capture")) await tick();
      capture = take("backup_export_capture");
      const before = calls.length;
      for (const origin of ["user", "agent", "plugin:writer"] as const) {
        await expect(
          events.commitDomainEvents({ type: "book.starred", payload: { bookId: "b", starred: true }, origin }),
        ).rejects.toMatchObject({ code: "backup/busy" });
      }
      await expect(
        events.appendDomainEvents([{ type: "book.starred", payload: { bookId: "b", starred: true } }]),
      ).rejects.toMatchObject({ code: "backup/busy" });
      const candidates = [
        () =>
          decideEntity(
            {
              op: "resolve",
              entityId: "e",
              kind: "person",
              canonicalName: "Name",
              expectedRevision: `entities1:${"a".repeat(64)}`,
            },
            "plugin:writer",
          ),
        () => mutateMemory({ op: "forget", memoryId: "m", expectedRevision: `mem1:${"a".repeat(64)}` }, "agent"),
        () =>
          changeBookClassification(
            { bookId: "b", narrativity: "expository", expectedRevision: `bcl1:${"a".repeat(64)}` },
            "user",
          ),
        () =>
          saveBookDigest(
            "b",
            { chapterIndex: 0, summary: "Summary", characters: [], relations: [], digestVersion: 1 },
            `bdg1:${"a".repeat(64)}`,
          ),
        () =>
          commitAnnotationMutations(
            [{ op: "updateNote", annotationId: "n", body: "new", expectedRevision: `ann1:${"a".repeat(64)}` }],
            "plugin:writer",
          ),
        () => kv.localKV.setItemAsync("read-aware-app-settings", "denied"),
        () => secrets.setSecretAsync("ai-api-key.proof", "denied"),
        () => secrets.setPluginSecret("writer", "token", "denied"),
      ];
      for (const candidate of candidates) await expect(candidate()).rejects.toMatchObject({ code: "backup/busy" });
      kv.localKV.setItem("read-aware-app-settings", "optimistic candidate");
      settingMirror = "optimistic candidate";
      await tick();
      expect(settingMirror).toBe('{"theme":"dark"}');
      // Rejected admissions only log; no domain, KV or credential IPC is dispatched.
      expect(calls.slice(before).filter((command) => command !== "plugin:log|log")).toEqual([]);
      expect(kv.localKV.getItem("read-aware-app-settings")).toBe('{"theme":"dark"}');
      expect(secrets.getSecret("ai-api-key.proof")).toBe("synthetic");
      expect(failures).toEqual([
        expect.objectContaining({ kind: "kv", code: "backup/busy" }),
        expect.objectContaining({ kind: "secret", code: "backup/busy" }),
        expect.objectContaining({ kind: "kv", code: "backup/busy" }),
      ]);
      capture.resolve({ taskId: capture.args.taskId, format: 2 });
      expect(await backup).toBe(true);
      await events.commitDomainEvents({ type: "book.starred", payload: { bookId: "b", starred: true } });
    } finally {
      capture?.resolve({ taskId: capture.args.taskId, format: 2 });
      holds.clear();
      await backup.catch(() => {}); /* asserted above; cleanup only waits for it to settle */
      off();
      stopMirror();
    }
  });

  // Runs last: a dispatched restore keeps the domain fence until reload.
  test("full restore keeps the domain fence after cancelling a dispatched apply", async () => {
    holds.add("backup_import_apply");
    const controller = new AbortController();
    const request = { rowRevision: "rows", files: {}, programs: {}, programResults: {}, credentials: {} };
    const restore = applyFullBackup("task", request, () => {}, controller.signal).catch((error) => error);
    while (!pending.some((item) => item.command === "backup_import_apply")) await tick();
    controller.abort();
    await tick();
    await expect(kv.localKV.setItemAsync("later", "denied")).rejects.toMatchObject({ code: "backup/busy" });
    await expect(
      events.commitDomainEvents({ type: "book.starred", payload: { bookId: "b", starred: true } }),
    ).rejects.toMatchObject({ code: "backup/busy" });
    let settled = false;
    void restore.then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);
  });
} else {
  test("isolated production domain backup admission", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, BACKUP_DOMAIN_PROOF: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("4 pass");
  }, 30_000);
}
