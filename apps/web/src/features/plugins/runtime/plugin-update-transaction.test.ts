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
      "commit",
      "verify-commit",
      "quiesce",
      "migrate",
      "promote",
      "accept",
      "retire",
    ]);
  });

  test("a failed health check leaves disk untouched and restores recoverable data", async () => {
    const log: string[] = [];

    await expect(
      runPluginUpdateTransaction(transaction(log, "verify-candidate")),
    ).rejects.toThrow("verify-candidate failed");
    expect(log).toEqual([
      "start",
      "verify-candidate",
      "cleanup",
      "restore-data",
      "restart-previous",
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
      "commit",
      "verify-commit",
      "cleanup",
      "rollback-files",
      "restore-data",
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
      "commit",
      "verify-commit",
      "quiesce",
      "migrate",
      "cleanup",
      "rollback-files",
      "restore-data",
      "restart-previous",
    ]);
  });
});
