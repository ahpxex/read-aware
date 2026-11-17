import { causalActor, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import { AppError } from "@read-aware/core";
import { validBackupPassword } from "./backup-password";
import type { BackupReviewPage, BackupReviewQuery } from "./backup-review-types";

import type { BackupProgramChoice } from "../../plugins/runtime/backup-program-review";
import type { BackupProgramStageQuery, BackupProgramStageReceipt } from "../../plugins/runtime/backup-program-storage";
export type BackupProgramStageRequest = {
  id: string;
  choices: Record<string, BackupProgramChoice>;
  consented: boolean;
};

import type { FullBackupRestoreRequest, FullBackupApplyReceipt, FullBackupRestoreReceipt } from "./full-backup-apply";

export type FullBackupImportProgress =
  | "decrypting"
  | "checkingSource"
  | "comparingEvents"
  | "comparingRows"
  | "comparingFiles"
  | "preparingReview"
  | "restoring";
export type BackupSourceSummary = {
  format: 2;
  schemaVersion: number;
  tables: Record<string, number>;
  events: number;
  blobs: number;
  credentials: number;
  pluginPrograms: number;
};
export type BackupComparisonCounts = {
  sourceOnly: number;
  targetOnly: number;
  same: number;
  different: number;
  unavailable: number;
};
export type BackupPlanSummary = {
  newEvents: number;
  existingEvents: number;
  conflictingEvents: number;
  tables: Record<
    string,
    { sourceRows: number; targetRows: number; comparisons: BackupComparisonCounts | null; generatedOnly: number }
  >;
  files: BackupComparisonCounts;
  pluginPrograms: number;
};
export type BackupSourceReceipt = BackupSourceSummary & { taskId: string };
export type BackupPlanReceipt = BackupPlanSummary & { taskId: string };
type Dependencies = {
  id(): string;
  selectSource(): Promise<string | null>;
  open(
    taskId: string,
    source: string,
    password: string,
    progress: (update: FullBackupImportProgress) => void,
  ): Promise<BackupSourceReceipt>;
  /** Holds the capture fences only around physical target planning. */
  plan(
    taskId: string,
    progress: (update: FullBackupImportProgress) => void,
    signal?: AbortSignal,
  ): Promise<BackupPlanReceipt>;
  read(taskId: string, query: BackupReviewQuery): Promise<BackupReviewPage>;
  stageProgram(taskId: string, request: BackupProgramStageRequest): Promise<BackupProgramStageReceipt>;
  stageStorage<T>(taskId: string, token: string, query: BackupProgramStageQuery): Promise<T>;
  apply(
    taskId: string,
    request: FullBackupRestoreRequest,
    progress: (update: FullBackupImportProgress) => void,
    signal?: AbortSignal,
    origin?: DomainActor,
  ): Promise<FullBackupApplyReceipt>;
  cancel(taskId: string): Promise<void>;
  warn(message: string, error: unknown): void;
};
export type FullBackupReview = {
  readonly source: BackupSourceSummary;
  readonly plan: BackupPlanSummary;
  /** Admission has closed; await dispose() for the physical cleanup receipt. */
  readonly disposed: boolean;
  read(query: BackupReviewQuery, signal?: AbortSignal): Promise<BackupReviewPage>;
  stageProgram(request: BackupProgramStageRequest): Promise<BackupProgramStageReceipt>;
  stageStorage<T>(token: string, query: BackupProgramStageQuery): Promise<T>;
  apply(request: FullBackupRestoreRequest, origin?: DomainActor): Promise<FullBackupRestoreReceipt>;
  dispose(): Promise<void>;
};

/** Preparation only. A returned review retains native private data; it is not
 * a completed import, executable approval or actor-visible resource. */
export function createFullBackupImport(deps: Dependencies) {
  return async (
    password: string,
    signal?: AbortSignal,
    onProgress?: (update: FullBackupImportProgress) => void,
  ): Promise<FullBackupReview | null> => {
    signal?.throwIfAborted();
    if (!validBackupPassword(password)) throw new AppError("backup/password-policy", "Invalid backup password length");
    const sourcePath = await deps.selectSource();
    signal?.throwIfAborted();
    if (sourcePath === null) return null;
    const taskId = deps.id();
    let retained = false,
      disposed = false,
      consuming = false,
      cancelling: Promise<void> | undefined,
      disposal: Promise<void> | undefined;
    let operations = Promise.resolve(),
      pendingOperations = 0;
    const cancel = (): Promise<void> =>
      (cancelling ??= Promise.resolve()
        .then(() => deps.cancel(taskId))
        .catch((error) => deps.warn("Full backup import cleanup failed", error))
        .finally(() => {
          cancelling = undefined;
        }));
    const dispose = (): Promise<void> =>
      (disposal ??= (async () => {
        disposed = true;
        signal?.removeEventListener("abort", abort);
        const retirement = pendingOperations > 0 ? cancel() : undefined;
        await operations;
        await retirement;
        await cancelling;
        // A cancel during a native review operation retires it on physical completion. Retry
        // after that receipt if an earlier cancellation IPC could not reach it.
        await cancel();
      })());
    const abort = () => {
      void (retained ? dispose() : cancel());
    };
    const progress = (update: FullBackupImportProgress) => {
      if (signal?.aborted) {
        abort();
        return;
      }
      try {
        onProgress?.(update);
      } catch (error) {
        deps.warn("Full backup import observer failed", error);
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      const source = await deps.open(taskId, sourcePath, password, progress);
      signal?.throwIfAborted();
      if (source?.taskId !== taskId || source.format !== 2)
        throw new AppError("backup/changed", "Unexpected source preparation receipt");
      const plan = await deps.plan(taskId, progress, signal);
      signal?.throwIfAborted();
      if (plan?.taskId !== taskId) throw new AppError("backup/changed", "Unexpected import planning receipt");
      const { taskId: _sourceId, ...sourceSummary } = source;
      const { taskId: _planId, ...planSummary } = plan;
      const enqueue = <T>(run: () => Promise<T>, readSignal?: AbortSignal, decision = false): Promise<T> => {
        readSignal?.throwIfAborted();
        if (disposed || consuming)
          return Promise.reject(new AppError("backup/changed", "Backup review has been disposed"));
        if (pendingOperations >= 32) return Promise.reject(new AppError("backup/busy", "Backup review queue is full"));
        pendingOperations++;
        const operation = operations
          .then(async () => {
            readSignal?.throwIfAborted();
            if (disposed) throw new AppError("backup/changed", "Backup review has been disposed");
            const result = await run();
            // Read cancellation discards only a page. Draft edits have no separate
            // abort signal: once sent they return their physical decision receipt.
            readSignal?.throwIfAborted();
            if (disposed && !decision) throw new AppError("backup/changed", "Backup review has been disposed");
            return result;
          })
          .finally(() => {
            pendingOperations--;
          });
        operations = operation.then(
          () => {},
          () => {
            /* The caller owns failure; later operations may continue. */
          },
        );
        return operation;
      };
      const read = (query: BackupReviewQuery, readSignal?: AbortSignal): Promise<BackupReviewPage> => {
        readSignal?.throwIfAborted();
        const candidate = structuredClone(query);
        if (!Number.isSafeInteger(candidate.limit) || candidate.limit < 1 || candidate.limit > 100) {
          return Promise.reject(new AppError("backup/invalid-archive", "Invalid backup review page limit"));
        }
        return enqueue(async () => {
          const page = await deps.read(taskId, candidate);
          if (page.kind !== candidate.kind) throw new AppError("backup/changed", "Unexpected backup review page");
          return page;
        }, readSignal);
      };
      const stageProgram = (request: BackupProgramStageRequest) => {
        const candidate = structuredClone(request);
        return enqueue(() => deps.stageProgram(taskId, candidate));
      };
      const stageStorage = <T>(token: string, query: BackupProgramStageQuery): Promise<T> => {
        const candidate = structuredClone(query);
        return enqueue(() => deps.stageStorage<T>(taskId, token, candidate));
      };
      const apply = (
        request: FullBackupRestoreRequest,
        origin: DomainActor = "user",
      ): Promise<FullBackupRestoreReceipt> => {
        if (disposed || consuming)
          return Promise.reject(new AppError("backup/changed", "Backup review has been disposed"));
        if (pendingOperations >= 32) return Promise.reject(new AppError("backup/busy", "Backup review queue is full"));
        origin = causalActor(origin);
        const candidate = structuredClone(request);
        const pending = enqueue(
          async () => {
            const receipt = await deps.apply(taskId, candidate, progress, signal, origin);
            if (receipt.taskId !== taskId || receipt.format !== 2)
              throw new AppError("backup/recovery-required", "Unexpected restore decision receipt");
            const { taskId: _taskId, ...result } = receipt;
            return stampEventCause(result, origin);
          },
          undefined,
          true,
        );
        consuming = true;
        return pending.finally(() => {
          disposed = true;
          signal?.removeEventListener("abort", abort);
        });
      };
      retained = true;
      return {
        source: sourceSummary,
        plan: planSummary,
        get disposed() {
          return disposed;
        },
        read,
        stageProgram,
        stageStorage,
        apply,
        dispose,
      };
    } finally {
      // Cancellation before native admission can initially miss. Wait for
      // physical preparation/planning, then retry cleanup before returning.
      if (!retained) await dispose();
    }
  };
}
