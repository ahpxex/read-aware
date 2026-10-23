import { expect, test } from "bun:test";

if (process.env.FULL_EXPORT_PROOF === "1") {
  const calls: string[] = [];
  let sources: string[] = [];
  let chosenFor: string | undefined;
  let capturing: ReturnType<typeof Promise.withResolvers<void>>;
  let releaseCapture: ReturnType<typeof Promise.withResolvers<void>>;
  let writing: ReturnType<typeof Promise.withResolvers<void>>;
  let releaseWrite: ReturnType<typeof Promise.withResolvers<void>>;
  const native = async (command: string, args: any): Promise<unknown> => {
    calls.push(command);
    if (command === "backup_export_choose_destination") {
      chosenFor = args.taskId;
      return "/synthetic/backup.age";
    }
    if (command === "backup_export_sources") return sources;
    if (command === "sync_profile_get") return { syncEnabled: false };
    if (command === "backup_export_capture") {
      expect(args.password).toBeUndefined();
      expect(args.destination).toBeUndefined();
      capturing.resolve();
      await releaseCapture.promise;
      return { taskId: args.taskId, format: 2 };
    }
    if (command === "backup_export_write") {
      expect(args.password).toBe("a synthetic password");
      // The native grant bound at the dialog carries the destination.
      expect(args.destination).toBeUndefined();
      expect(args.taskId).toBe(chosenFor);
      writing.resolve();
      await releaseWrite.promise;
      return true;
    }
    if (["reading_sessions_pending", "backup_close_reading_sessions", "secret_keys"].includes(command)) return [];
    return undefined;
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_INTERNALS__: { invoke: native, transformCallback: () => 1 } },
  });
  const { exportFullBackup } = await import("../features/settings/lib/full-backup-export");
  const { localKV } = await import("./local-store");
  const { runDomainWrite } = await import("./domain-write-gate");

  test("production export closes facts and fences capture, then allows writes during encryption", async () => {
    capturing = Promise.withResolvers();
    releaseCapture = Promise.withResolvers();
    writing = Promise.withResolvers();
    releaseWrite = Promise.withResolvers();
    const task = exportFullBackup("a synthetic password");
    await capturing.promise;
    expect(calls.indexOf("backup_export_choose_destination")).toBeLessThan(calls.indexOf("backup_export_sources"));
    expect(calls.indexOf("backup_close_reading_sessions")).toBeLessThan(calls.indexOf("backup_export_capture"));
    await expect(localKV.setItemAsync("export-proof", "denied")).rejects.toMatchObject({ code: "backup/busy" });
    releaseCapture.resolve();
    await writing.promise;
    await localKV.setItemAsync("export-proof", "accepted");
    expect(localKV.getItem("export-proof")).toBe("accepted");
    releaseWrite.resolve();
    expect(await task).toBe(true);
    expect(calls.at(-1)).toBe("backup_export_cancel");
  });

  test("missing registered files fail preparation without a partial capture or retained write fence", async () => {
    calls.length = 0;
    sources = ["booktext:remote-only"];
    await expect(exportFullBackup("a synthetic password")).rejects.toMatchObject({ code: "backup/incomplete" });
    expect(calls).not.toContain("backup_export_capture");
    expect(calls).not.toContain("backup_export_write");
    expect(await runDomainWrite(async () => "released")).toBe("released");
    sources = [];
  });
} else {
  test("isolated production full export gates and source preparation", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, FULL_EXPORT_PROOF: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("2 pass");
  }, 30_000);
}
