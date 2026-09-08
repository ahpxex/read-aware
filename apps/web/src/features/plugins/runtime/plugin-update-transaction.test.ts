import { describe, expect, test } from "bun:test";
import { runPluginUpdateTransaction } from "./plugin-update-transaction";

function transaction(log: string[], fail?: string) {
  const step = async (name: string): Promise<void> => {
    log.push(name);
    if (fail === name) throw new Error(`${name} failed`);
  };
  return {
    startCandidate: async () => {
      await step("start");
      return { version: 2 };
    },
    verifyCandidate: () => step("verify-candidate"),
    commitFiles: () => step("commit"),
    verifyCommit: () => step("verify-commit"),
    quiescePrevious: () => step("quiesce"),
    snapshotData: () => step("snapshot"),
    migrateCandidate: () => step("migrate"),
    promoteCandidate: () => step("promote"),
    accept: () => step("accept"),
    retirePrevious: () => step("retire"),
    cleanupCandidate: () => step("cleanup"),
    rollbackFiles: () => step("rollback-files"),
    restoreData: () => step("restore-data"),
    restartPrevious: () => step("restart-previous"),
  };
}

describe("plugin update transaction", () => {
  test("accepts only after candidate health and the disk switch", async () => {
    const log: string[] = [];

    await runPluginUpdateTransaction(transaction(log));

    expect(log).toEqual([
      "start",
      "verify-candidate",
      "quiesce",
      "snapshot",
      "commit",
      "verify-commit",
      "migrate",
      "promote",
      "accept",
      "retire",
    ]);
  });

  test("a failed health check leaves the live runtime and its data untouched", async () => {
    const log: string[] = [];

    await expect(
      runPluginUpdateTransaction(transaction(log, "verify-candidate")),
    ).rejects.toThrow("verify-candidate failed");
    expect(log).toEqual([
      "start",
      "verify-candidate",
      "cleanup",
    ]);
  });

  test("a post-commit failure attempts every recovery step", async () => {
    const log: string[] = [];
    const value = transaction(log, "verify-commit");
    value.cleanupCandidate = async () => {
      log.push("cleanup");
      throw new Error("cleanup failed");
    };

    await expect(runPluginUpdateTransaction(value)).rejects.toThrow(
      /verify-commit failed.*cleanup failed/,
    );
    expect(log).toEqual([
      "start",
      "verify-candidate",
      "quiesce",
      "snapshot",
      "commit",
      "verify-commit",
      "cleanup",
      "rollback-files",
      "restart-previous",
    ]);
  });

  test("a migration failure restores files, data, and the quiesced runtime", async () => {
    const log: string[] = [];

    await expect(runPluginUpdateTransaction(transaction(log, "migrate"))).rejects.toThrow(
      "migrate failed",
    );
    expect(log).toEqual([
      "start",
      "verify-candidate",
      "quiesce",
      "snapshot",
      "commit",
      "verify-commit",
      "migrate",
      "cleanup",
      "rollback-files",
      "restore-data",
      "restart-previous",
    ]);
  });

  test("rollback preserves legitimate old-runtime writes made during candidate checks", async () => {
    const value = transaction([]);
    let data = "before";
    let snapshot: string | undefined;
    value.verifyCandidate = async () => { data = "saved-by-old-runtime"; };
    value.snapshotData = async () => { snapshot = data; };
    value.migrateCandidate = async () => { data = "candidate-schema"; throw new Error("migration failed"); };
    value.restoreData = async () => { data = snapshot!; };
    await expect(runPluginUpdateTransaction(value)).rejects.toThrow("migration failed");
    expect(data).toBe("saved-by-old-runtime");
  });

  test("failed snapshot restarts the old runtime without restoring nonexistent data", async () => {
    const log: string[] = [];
    await expect(runPluginUpdateTransaction(transaction(log, "snapshot"))).rejects.toThrow("snapshot failed");
    expect(log).toEqual(["start", "verify-candidate", "quiesce", "snapshot", "cleanup", "restart-previous"]);
  });

  test("partially failed quiescence still attempts runtime recovery", async () => {
    const log: string[] = [];
    await expect(runPluginUpdateTransaction(transaction(log, "quiesce"))).rejects.toThrow("quiesce failed");
    expect(log).toEqual(["start", "verify-candidate", "quiesce", "cleanup", "restart-previous"]);
  });

  test("snapshot cannot begin until accepted old writes are drained", async () => {
    const log: string[] = [];
    const value = transaction(log);
    let release!: () => void;
    value.quiescePrevious = () => new Promise<void>(resolve => { log.push("quiesce-pending"); release = resolve; });
    const update = runPluginUpdateTransaction(value);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(log).toEqual(["start", "verify-candidate", "quiesce-pending"]);
    release(); await update;
    expect(log.indexOf("snapshot")).toBeGreaterThan(log.indexOf("quiesce-pending"));
  });
});
