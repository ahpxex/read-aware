import { canUseHostService, AppError, type DurableJobPlan } from "@read-aware/core";
import type { PluginManifest } from "@read-aware/plugin-types";
import { openFencedAccess, type PluginBookAccessPolicy } from "../../../domain/plugin-object-access";
import type { TransactionSession } from "../../../domain/transactions";
import { DurableJobRunner } from "../../../domain/durable-jobs";
import { createDurableJobExecutor } from "../../../domain/durable-job-executor";
import { nativeDurableJobStore } from "../../../platform/durable-jobs";
import type { DomainActor } from "../../../platform/domain-actor";
import { createLogger } from "../../../platform/logger";
import type { PluginLifecycleController } from "./plugin-lifecycle";

export function createPluginJobs(
  manifest: PluginManifest,
  access: PluginBookAccessPolicy,
  lifecycle: PluginLifecycleController,
  transactions: TransactionSession,
  actor: DomainActor,
) {
  const permissions = new Set(manifest.permissions ?? []);
  const live = () => {
    lifecycle.assertActive("services.jobs");
    lifecycle.signal.throwIfAborted();
  };
  const acquireBook = async (bookId: string, signal: AbortSignal) => {
    live();
    signal.throwIfAborted();
    const fence = await access.beginBook(bookId, "durable job");
    try {
      await fence.assertUnchanged({ retain: true });
      signal.throwIfAborted();
      live();
    } catch (error) {
      fence.dispose();
      throw error;
    }
    // A durable job outlives the call that admitted it, so each step also
    // re-asserts that the plugin is active and still holds the book.
    return openFencedAccess(fence, [signal, lifecycle.signal], () => {
      if (lifecycle.phase !== "active") return false;
      try {
        access.assertBook(bookId, "durable job");
        return true;
      } catch {
        return false;
      }
    });
  };
  const authorize = async (plan: DurableJobPlan, signal: AbortSignal) => {
    live();
    signal.throwIfAborted();
    const grants: Array<{ assert(): void | Promise<void>; dispose(): void }> = [];
    try {
      for (const step of plan.steps) {
        if (step.kind === "transaction")
          grants.push(await transactions.authorizeDurableOperations(step.operations, signal));
        else {
          if (step.kind === "book.graph" && !canUseHostService("llm", permissions)) {
            throw new AppError("plugin/permission-denied", "Graph job steps require service:llm");
          }
          const required = step.kind === "book.graph" ? "memory:write" : "library:read";
          if (!permissions.has(required) && !(required === "library:read" && permissions.has("library:write")))
            throw new AppError("plugin/permission-denied", "Job step permission is not granted");
          const grant = await acquireBook(step.bookId, signal);
          grants.push({
            assert: () => {
              if (!grant.isAllowed()) throw new AppError("plugin/object-access-denied", "Job book grant expired");
            },
            dispose: grant.dispose,
          });
        }
      }
      return {
        assert: async () => {
          live();
          signal.throwIfAborted();
          for (const grant of grants) await grant.assert();
        },
        dispose: () => {
          for (const grant of grants) grant.dispose();
        },
      };
    } catch (error) {
      for (const grant of grants) grant.dispose();
      throw error;
    }
  };
  const log = createLogger("plugin-jobs");
  const runner = new DurableJobRunner(
    nativeDurableJobStore(`plugin:${manifest.id}`),
    createDurableJobExecutor({
      actor,
      transactions,
      authorize,
      acquireBook,
      report: (error) => log.error("Durable plugin job failed", error),
    }),
  );
  lifecycle.stage(() => {
    void runner.recover().catch((error) => log.error("Durable plugin job recovery failed", error));
    return {
      dispose: () => {
        lifecycle.trackCleanup(runner.stop());
      },
    };
  });
  lifecycle.signal.addEventListener("abort", () => lifecycle.trackCleanup(runner.stop()), { once: true });
  return runner;
}
