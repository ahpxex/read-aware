import { expect, spyOn, test } from "bun:test";

if (process.env.BACKUP_SCHEDULES_PROOF === "1") {
  let capture: Promise<void> | undefined;
  const native = async (command: string, args: any): Promise<unknown> => {
    if (command === "backup_export_choose_destination") return "/synthetic/backup.age";
    if (command === "backup_export_capture") {
      await capture;
      return { taskId: args.taskId, format: 2 };
    }
    if (command === "local_device_get")
      return { deviceId: "schedule-proof", lastHlcWallMs: null, lastHlcCounter: null };
    if (command === "backup_export_write") return true;
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
  const kv = await import("../../../platform/local-store");
  const { pluginSchedules } = await import("../../plugins/runtime/plugin-scheduler");
  const { exportFullBackup } = await import("./full-backup-export");
  const password = "a synthetic backup password";

  test("a production schedule can await the complete export path without joining its own flight", async () => {
    const write = spyOn(kv.localKV, "setItemAsync").mockResolvedValue();
    let saved: boolean | undefined;
    const owner = pluginSchedules.register(
      "backup-schedule",
      { id: "export", label: "Export", everyMinutes: 60 },
      async () => {
        saved = await exportFullBackup(password);
      },
    );
    try {
      expect((await pluginSchedules.control({ pluginId: "backup-schedule", id: "export", action: "run" })).status).toBe(
        "completed",
      );
      expect(saved).toBe(true);
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      owner.dispose();
      await pluginSchedules.drainWrites("backup-schedule");
      write.mockRestore();
    }
  });

  test("production export holds a task's final receipt until capture ends", async () => {
    const write = spyOn(kv.localKV, "setItemAsync").mockResolvedValue();
    const callback = Promise.withResolvers<void>(),
      captured = Promise.withResolvers<void>();
    capture = captured.promise;
    const owner = pluginSchedules.register(
      "backup-schedule",
      { id: "late", label: "Late", everyMinutes: 60 },
      () => callback.promise,
    );
    const execution = pluginSchedules.control({ pluginId: "backup-schedule", id: "late", action: "run" });
    let backup: Promise<boolean> | undefined;
    try {
      await Bun.sleep(0);
      expect(write).toHaveBeenCalledTimes(1);
      backup = exportFullBackup(password);
      await Bun.sleep(0);
      callback.resolve();
      await Bun.sleep(0);
      expect(write).toHaveBeenCalledTimes(1);
      captured.resolve();
      expect(await backup).toBe(true);
      expect((await execution).schedule.lastOutcome).toBe("succeeded");
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      callback.resolve();
      captured.resolve();
      capture = undefined;
      await Promise.allSettled([execution, backup]);
      owner.dispose();
      await pluginSchedules.drainWrites("backup-schedule");
      write.mockRestore();
    }
  });
} else {
  test("isolated plugin schedules around the production full export", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, BACKUP_SCHEDULES_PROOF: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("2 pass");
  }, 30_000);
}
