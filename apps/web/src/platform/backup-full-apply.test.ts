import { expect, test } from "bun:test";

const scenario = process.env.FULL_APPLY_PROOF;
if (scenario) {
  const { AppError } = await import("@read-aware/core");
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const receipt = {
    taskId: "owned-task",
    format: 2 as const,
    restoreId: "ed90d315-9313-4e89-80b2-973052a756c6",
    domainRows: 3,
    files: 2,
    plugins: 1,
    credentials: 1,
    cleanupPending: false,
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener() {},
      removeEventListener() {},
      __TAURI_INTERNALS__: {
        transformCallback: () => 1,
        invoke: async (command: string) => {
          if (command === "backup_import_apply") {
            entered.resolve();
            await release.promise;
            if (scenario !== "committed") throw new AppError(scenario, "Synthetic restore failure");
            return receipt;
          }
          if (["reading_sessions_pending", "backup_close_reading_sessions", "secret_keys"].includes(command)) return [];
        },
      },
    },
  });
  const { applyFullBackup } = await import("../features/settings/lib/full-backup-apply");
  const { runDomainWrite } = await import("./domain-write-gate");
  test(`production restore reservations: ${scenario}`, async () => {
    const controller = new AbortController();
    const result = applyFullBackup(
      "owned-task",
      { files: {}, programs: {}, programResults: {}, credentials: {} },
      () => {},
      controller.signal,
    );
    const settled = result.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await entered.promise;
    await expect(runDomainWrite(() => true)).rejects.toMatchObject({ code: "backup/busy" });
    release.resolve();
    const outcome = await settled;
    if (scenario === "committed") expect(outcome).toEqual({ value: receipt });
    else expect(outcome).toMatchObject({ error: { code: scenario } });
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (scenario === "backup/changed") expect(await runDomainWrite(() => true)).toBe(true);
    else await expect(runDomainWrite(() => true)).rejects.toMatchObject({ code: "backup/busy" });
  });
} else {
  for (const value of ["committed", "backup/changed", "backup/recovery-required"]) {
    test(`isolated production restore: ${value}`, async () => {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        env: { ...process.env, FULL_APPLY_PROOF: value },
        stdout: "ignore",
        stderr: "pipe",
      });
      const output = await new Response(child.stderr).text();
      expect(await child.exited, output).toBe(0);
      expect(output).toContain("1 pass");
    }, 30_000);
  }
}
