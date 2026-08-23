export type PluginUpdateTransaction<TCandidate> = {
  startCandidate(): Promise<TCandidate>;
  verifyCandidate(candidate: TCandidate): void | Promise<void>;
  commitFiles(): Promise<void>;
  verifyCommit(candidate: TCandidate): void | Promise<void>;
  /** Stop the old runtime before shared plugin data can change. */
  quiescePrevious(): void | Promise<void>;
  migrateCandidate(candidate: TCandidate): void | Promise<void>;
  /** Explicit side-effect boundary: candidate contributions become live here. */
  promoteCandidate(candidate: TCandidate): void | Promise<void>;
  accept(candidate: TCandidate): void | Promise<void>;
  retirePrevious(): void | Promise<void>;
  cleanupCandidate(candidate: TCandidate | undefined): void | Promise<void>;
  rollbackFiles(): void | Promise<void>;
  restoreData(): void | Promise<void>;
  restartPrevious(): void | Promise<void>;
};

export class PluginUpdateError extends Error {
  readonly cause: unknown;
  readonly recoveryErrors: Error[];

  constructor(cause: unknown, recoveryErrors: Error[]) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const recovery = recoveryErrors.length
      ? ` Recovery also failed: ${recoveryErrors.map((error) => error.message).join("; ")}`
      : "";
    super(message + recovery);
    this.name = "PluginUpdateError";
    this.cause = cause;
    this.recoveryErrors = recoveryErrors;
  }
}

/**
 * The update state machine, separated from Tauri/Worker details so its ordering
 * and failure guarantees stay executable as a contract.
 */
export async function runPluginUpdateTransaction<TCandidate>(
  transaction: PluginUpdateTransaction<TCandidate>,
): Promise<TCandidate> {
  let candidate: TCandidate | undefined;
  let committed = false;
  try {
    candidate = await transaction.startCandidate();
    await transaction.verifyCandidate(candidate);
    await transaction.commitFiles();
    committed = true;
    await transaction.verifyCommit(candidate);
    await transaction.quiescePrevious();
    await transaction.migrateCandidate(candidate);
    await transaction.promoteCandidate(candidate);
    await transaction.accept(candidate);
    await transaction.retirePrevious();
    return candidate;
  } catch (cause) {
    const recoveryErrors: Error[] = [];
    const recover = async (step: () => void | Promise<void>) => {
      try {
        await step();
      } catch (error) {
        recoveryErrors.push(error instanceof Error ? error : new Error(String(error)));
      }
    };

    await recover(() => transaction.cleanupCandidate(candidate));
    if (committed) await recover(transaction.rollbackFiles);
    await recover(transaction.restoreData);
    await recover(transaction.restartPrevious);
    throw new PluginUpdateError(cause, recoveryErrors);
  }
}
