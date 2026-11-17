import { expect, test } from "bun:test";

if (process.env.BACKUP_ISOLATION_PROOF === "1") {
  const calls: string[] = [];
  const holds = new Map<string, Promise<void>>();
  let captureFailure: unknown;
  const native = async (command: string, args: any): Promise<unknown> => {
    calls.push(command);
    await holds.get(command);
    if (command === "backup_export_choose_destination") return "/synthetic/backup.age";
    if (command === "plugin:dialog|open") return "/synthetic/source.age";
    if (command === "backup_export_capture") {
      if (captureFailure) throw captureFailure;
      return { taskId: args.taskId, format: 2 };
    }
    if (command === "backup_import_open")
      return {
        taskId: args.taskId,
        format: 2,
        schemaVersion: 1,
        tables: {},
        events: 0,
        blobs: 0,
        credentials: 0,
        pluginPrograms: 0,
      };
    if (command === "backup_import_plan")
      return {
        taskId: args.taskId,
        newEvents: 0,
        existingEvents: 0,
        conflictingEvents: 0,
        tables: {},
        files: { sourceOnly: 0, targetOnly: 0, same: 0, different: 0, unavailable: 0 },
        pluginPrograms: 0,
      };
    if (command === "local_device_get")
      return { deviceId: "isolation-proof", lastHlcWallMs: null, lastHlcCounter: null };
    if (
      [
        "backup_export_sources",
        "reading_sessions_pending",
        "backup_close_reading_sessions",
        "secret_keys",
        "restored_credentials_pending",
      ].includes(command)
    )
      return [];
    return undefined;
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout,
      clearTimeout,
      addEventListener() {},
      removeEventListener() {},
      __TAURI_INTERNALS__: { invoke: native, transformCallback: () => 1 },
    },
  });
  const { PluginPreferencePublication } = await import("../../../platform/plugin-preference-publication");
  const { withPluginDataUpdate } = await import("../../../platform/plugin-data-access");
  const { exportFullBackup } = await import("./full-backup-export");
  const { prepareFullBackupImport } = await import("./full-backup-import");
  const { applyFullBackup } = await import("./full-backup-apply");
  const password = "a synthetic backup password";
  const gate = () => Promise.withResolvers<void>();
  const request = { files: {}, programs: {}, programResults: {}, credentials: {} };
  const entries = () => [
    () => exportFullBackup(password),
    () => prepareFullBackupImport(password),
    () => applyFullBackup("task", request, () => {}),
  ];
  const physical = ["backup_export_capture", "backup_import_plan", "backup_import_apply"];

  test("production backup entries reject migration and quarantined namespaces before any captured data access", async () => {
    const migrating = gate();
    const update = withPluginDataUpdate("backup-proof", () => migrating.promise);
    try {
      for (const run of entries()) await expect(run()).rejects.toMatchObject({ code: "plugin/data-busy" });
      expect(calls.filter((command) => physical.includes(command))).toEqual([]);
    } finally {
      migrating.resolve();
      await update;
    }
    const scope = PluginPreferencePublication.begin("backup-not-in-catalog", {});
    scope.quarantine();
    try {
      for (const run of entries()) await expect(run()).rejects.toMatchObject({ code: "plugin/recovery-required" });
      expect(calls.filter((command) => physical.includes(command))).toEqual([]);
    } finally {
      scope.rollback();
    }
  });

  test("a failed capture keeps plugin exclusion until its native work settles", async () => {
    const pending = gate();
    holds.set("backup_export_capture", pending.promise);
    captureFailure = { code: "db/locked", message: "capture failed" };
    const result = exportFullBackup(password).catch((error) => error);
    try {
      await Bun.sleep(0);
      expect(calls).toContain("backup_export_capture");
      await expect(withPluginDataUpdate("backup-late-reader", async () => {})).rejects.toMatchObject({
        code: "plugin/data-busy",
      });
      pending.resolve();
      expect(await result).toMatchObject({ code: "db/locked" });
      await withPluginDataUpdate("backup-late-reader", async () => {});
    } finally {
      pending.resolve();
      await result;
      holds.delete("backup_export_capture");
      captureFailure = undefined;
    }
  });

  test("cancelling import planning retains exclusion until the physical plan returns", async () => {
    const planning = gate(),
      controller = new AbortController();
    holds.set("backup_import_plan", planning.promise);
    const result = prepareFullBackupImport(password, controller.signal).catch((error) => error);
    try {
      await Bun.sleep(0);
      expect(calls).toContain("backup_import_plan");
      controller.abort();
      await expect(withPluginDataUpdate("backup-import-owner", async () => {})).rejects.toMatchObject({
        code: "plugin/data-busy",
      });
      planning.resolve();
      expect(await result).toMatchObject({ name: "AbortError" });
      expect(calls.at(-1)).toBe("backup_import_cancel");
      await withPluginDataUpdate("backup-import-owner", async () => {});
    } finally {
      planning.resolve();
      await result;
      holds.delete("backup_import_plan");
    }
  });
} else {
  test("isolated production backup plugin-data admission", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, BACKUP_ISOLATION_PROOF: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("3 pass");
  }, 30_000);
}
