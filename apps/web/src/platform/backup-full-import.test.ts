import { expect, test } from "bun:test";

if (process.env.FULL_IMPORT_PROOF === "1") {
  const calls: string[] = [];
  const opening = Promise.withResolvers<void>(),
    releaseOpen = Promise.withResolvers<void>();
  const planning = Promise.withResolvers<void>(),
    releasePlan = Promise.withResolvers<void>();
  const checkingRows = Promise.withResolvers<void>(),
    releaseCheck = Promise.withResolvers<void>();
  const native = async (command: string, args: any): Promise<unknown> => {
    calls.push(command);
    if (command === "plugin:dialog|open") return "/synthetic/source.age";
    if (command === "backup_import_open") {
      expect(args.source).toBe("/synthetic/source.age");
      expect(args.password).toBe("synthetic import password");
      opening.resolve();
      await releaseOpen.promise;
      return {
        taskId: args.taskId,
        format: 2,
        schemaVersion: 42,
        tables: {},
        events: 0,
        blobs: 0,
        credentials: 0,
        pluginPrograms: 0,
      };
    }
    if (command === "backup_import_plan") {
      expect(args.password).toBeUndefined();
      expect(args.source).toBeUndefined();
      planning.resolve();
      await releasePlan.promise;
      return {
        taskId: args.taskId,
        newEvents: 0,
        existingEvents: 0,
        conflictingEvents: 0,
        tables: {},
        files: { sourceOnly: 0, targetOnly: 0, same: 0, different: 0, unavailable: 0 },
        pluginPrograms: 0,
      };
    }
    if (command === "backup_import_check_rows") {
      expect(Object.keys(args).sort()).toEqual(["expectedRevision", "taskId"]);
      expect(args.expectedRevision).toBe("updated-revision");
      checkingRows.resolve();
      await releaseCheck.promise;
      return { revision: "updated-revision", selectedSourceRows: 1, issues: 0, constraintsPassed: true };
    }
    if (command === "backup_import_choose_rows") {
      expect(Object.keys(args).sort()).toEqual(["request", "taskId"]);
      expect(args.request.expectedRevision).toBe("fixed-revision");
      return { revision: "updated-revision", changed: 1 };
    }
    if (command === "backup_import_review") {
      expect(Object.keys(args).sort()).toEqual(["query", "taskId"]);
      return { kind: args.query.kind, entries: [], nextAfter: null };
    }
    if (["reading_sessions_pending", "backup_close_reading_sessions", "secret_keys"].includes(command)) return [];
    return undefined;
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_INTERNALS__: { invoke: native, transformCallback: () => 1 } },
  });
  const { prepareFullBackupImport } = await import("../features/settings/lib/full-backup-import");
  const { localKV } = await import("./local-store");
  test("production import decrypts before fences, closes reading only for planning, releases before review", async () => {
    const pending = prepareFullBackupImport("synthetic import password");
    await opening.promise;
    await localKV.setItemAsync("import-proof", "before-plan");
    expect(calls).not.toContain("backup_close_reading_sessions");
    releaseOpen.resolve();
    await planning.promise;
    expect(calls.indexOf("backup_close_reading_sessions")).toBeLessThan(calls.indexOf("backup_import_plan"));
    await expect(localKV.setItemAsync("import-proof", "denied")).rejects.toMatchObject({ code: "backup/busy" });
    releasePlan.resolve();
    const review = (await pending)!;
    await localKV.setItemAsync("import-proof", "after-plan");
    expect(calls).not.toContain("backup_import_cancel");
    expect(review.disposed).toBe(false);
    const before = calls.filter((command) => command === "backup_close_reading_sessions").length;
    expect(await review.read({ kind: "programs", limit: 10 })).toEqual({
      kind: "programs",
      entries: [],
      nextAfter: null,
    });
    expect(calls.filter((command) => command === "backup_close_reading_sessions")).toHaveLength(before);
    await localKV.setItemAsync("import-proof", "during-review");
    await review.dispose();
    expect(calls.at(-1)).toBe("backup_import_cancel");
  });
} else {
  test("isolated production full import preparation", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, FULL_IMPORT_PROOF: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("1 pass");
  }, 30_000);
}
