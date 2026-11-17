import {
  AppError,
  contextBundleSelector,
  normalizeBookClassification,
  normalizeBookGraphTaskOptions,
  normalizeContextBundleHistoryQuery,
  normalizeContextBundleReadQuery,
  normalizeMemoryMutation,
  normalizeMemoryPageQuery,
  normalizeMemoryQuery,
  validateMemoryId,
  type ContextBundle,
  type ContextBundleSelector,
  type MemoryObservationQuery,
  type MemoryObservationResult,
  type MemoryRecord,
} from "@read-aware/core";
import { normalizeBookGraphQuery } from "@read-aware/agent";
import type { PluginCallOptions, PluginContext } from "@read-aware/plugin-types";
import type { ActorDomainView } from "../../../domain/registry";
import { normalizeMemoryObservation } from "../../../domain/memory-observer";
import {
  pluginObjectAccessDenied,
  runFenced,
  type PluginBookAccessPolicy,
  type PluginBookAccessFence,
} from "../../../domain/plugin-object-access";
import type { ResourceAccess } from "../../../services/resource-access";
import type { ResourceOwner } from "../../../services/resource-owner";
import { pluginOperationSignal } from "./plugin-call-options";
import type { PluginLifecycleController } from "./plugin-lifecycle";
import { restricted, restrictSurface, type RestrictedPolicy } from "./plugin-restricted-surface";

type PluginMemory = NonNullable<PluginContext["domains"]["memory"]>;

/** Restrict the shared semantic memory API, including its asynchronous consumers.
 * Global profile/identity operations require an all-books grant; a book grant
 * never silently broadens a query or redacts an immutable context version. */
export function scopePluginMemory(
  memory: NonNullable<ActorDomainView["memory"]>,
  policy: PluginBookAccessPolicy,
  lifecycle: PluginLifecycleController,
  resources: ResourceOwner,
  canGenerate: boolean,
): PluginMemory {
  const denied = (operation: string): never => {
    throw pluginObjectAccessDenied(`memory.${operation}`);
  };
  const scopeBook = (scopes: readonly string[]) => {
    if (scopes.length !== 1 || !scopes[0]?.startsWith("book:")) return denied("scopes");
    const bookId = scopes[0].slice(5);
    policy.assertBook(bookId, "memory.scopes");
    return bookId;
  };
  const checkRecord = (record: MemoryRecord) => {
    scopeBook([record.scope]);
  };
  const recipeBook = (selector: ContextBundleSelector) => {
    if (selector.scope.kind !== "book") return denied("context");
    policy.assertBook(selector.scope.id, "memory.context");
    return selector.scope.id;
  };
  const checkBundle = (bundle: ContextBundle | null, selector: ContextBundleSelector) => {
    if (
      bundle &&
      (bundle.content.kind !== selector.kind ||
        bundle.content.scope.kind !== "book" ||
        selector.scope.kind !== "book" ||
        bundle.content.scope.id !== selector.scope.id)
    )
      denied("context result");
  };
  const begin = (operation: string, bookId?: string) =>
    bookId !== undefined
      ? policy.beginBook(bookId, `memory.${operation}`)
      : policy.grant.mode === "book"
        ? policy.beginBook(policy.grant.bookId, `memory.${operation}`)
        : policy.beginCurrent(`memory.${operation}`);

  async function run<T>(
    operation: string,
    bookId: string | undefined,
    work: (access: ResourceAccess) => Promise<T>,
    options?: PluginCallOptions,
    mode: "read" | "write" | "task" | "resource" = "read",
  ): Promise<T> {
    lifecycle.assertActive(`memory.${operation}`);
    const caller = pluginOperationSignal(lifecycle.signal, options);
    // Tasks and resources keep the access past the call; an admitted long task
    // must not survive a rejected handoff, which runFenced cancels.
    return runFenced(
      begin(operation, bookId),
      (access) =>
        mode === "read" || mode === "resource"
          ? lifecycle.read(`memory.${operation}`, () => work(access), access.signal)
          : work(access),
      { signals: [caller], retain: mode === "task" || mode === "resource" },
    );
  }

  const queryPolicy: RestrictedPolicy<PluginMemory["queries"]> = {
    profile: restricted.deny,
    profileContext: restricted.deny,
    entities: restricted.deny,
    search: restricted.read((input) => {
      const query = normalizeMemoryQuery(input),
        bookId = scopeBook(query.scopes);
      return run("search", bookId, async (access) => {
        const rows = await memory.queries.search(query);
        access.signal.throwIfAborted();
        rows.forEach(checkRecord);
        return rows;
      });
    }),
    page: restricted.read((input) => {
      const query = normalizeMemoryPageQuery(input),
        bookId = scopeBook(query.scopes);
      return run("page", bookId, async (access) => {
        const page = await memory.queries.page(query);
        access.signal.throwIfAborted();
        page.items.forEach(checkRecord);
        return page;
      });
    }),
    inspect: restricted.read((id) => {
      validateMemoryId(id);
      return run("inspect", undefined, async (access) => {
        const snapshot = await memory.queries.inspect(id, access.signal);
        access.signal.throwIfAborted();
        if (snapshot) checkRecord(snapshot.memory);
        return snapshot;
      });
    }),
    classification: restricted.read((bookId) =>
      run("classification", bookId, async (access) => {
        const snapshot = await memory.queries.classification(bookId, access.signal);
        access.signal.throwIfAborted();
        if (snapshot && snapshot.bookId !== bookId) denied("classification result");
        return snapshot;
      }),
    ),
    bookGraph: restricted.read((bookId, input) => {
      const query = normalizeBookGraphQuery(input ?? {});
      return run("bookGraph", bookId, () => memory.queries.bookGraph(bookId, query));
    }),
    getGraphTask: restricted.read((bookId, taskId) =>
      run("getGraphTask", bookId, async (access) => {
        const task = await memory.queries.getGraphTask(bookId, taskId);
        access.signal.throwIfAborted();
        if (task.bookId !== bookId) denied("getGraphTask result");
        return task;
      }),
    ),
    listGraphTasks: restricted.read((bookId) =>
      run("listGraphTasks", bookId, async (access) => {
        const tasks = await memory.queries.listGraphTasks(bookId);
        access.signal.throwIfAborted();
        if (tasks.some((task) => task.bookId !== bookId)) denied("listGraphTasks result");
        return tasks;
      }),
    ),
    context: {
      history: restricted.read((input, options) => {
        const query = normalizeContextBundleHistoryQuery(input),
          bookId = recipeBook(query);
        return run(
          "context.history",
          bookId,
          (access) => memory.queries.context.history(query, access.signal),
          options,
        );
      }),
      read: restricted.read((input, options) => {
        const query = normalizeContextBundleReadQuery(input),
          bookId = recipeBook(query);
        return run(
          "context.read",
          bookId,
          async (access) => {
            const bundle = await memory.queries.context.read(query, access.signal);
            access.signal.throwIfAborted();
            checkBundle(bundle, query);
            return bundle;
          },
          options,
        );
      }),
      export: restricted.read((input, options) => {
        const query = normalizeContextBundleReadQuery(input),
          bookId = recipeBook(query);
        // ResourceOwner owns the fence after this call, for every book recipe.
        return run(
          "context.export",
          bookId,
          (access) => memory.queries.context.export(query, resources, access.signal, access),
          options,
          "resource",
        );
      }),
    },
  };
  // Observation polls go through the built surface, so they share its lifecycle rules.
  const readObservation = async (query: MemoryObservationQuery): Promise<MemoryObservationResult> => {
    const queries = surface.queries;
    switch (query.kind) {
      case "profile":
      case "profileContext":
        return denied(query.kind);
      case "search":
        return { kind: query.kind, memories: await queries.search(query.query) };
      case "page":
        return { kind: query.kind, page: await queries.page(query.query) };
      case "inspect":
        return { kind: query.kind, snapshot: await queries.inspect(query.memoryId) };
      case "classification":
        return { kind: query.kind, snapshot: await queries.classification(query.bookId) };
      case "graphTasks":
        return { kind: query.kind, tasks: await queries.listGraphTasks(query.bookId) };
      case "graphTask":
        return { kind: query.kind, task: await queries.getGraphTask(query.bookId, query.taskId) };
      case "bookGraph":
        return { kind: query.kind, graph: await queries.bookGraph(query.bookId, query.query) };
    }
  };
  const commandPolicy = (
    commands: NonNullable<typeof memory.commands>,
  ): RestrictedPolicy<NonNullable<PluginMemory["commands"]>> => ({
    updateProfile: restricted.deny,
    completeOnboarding: restricted.deny,
    decideEntity: restricted.deny,
    mutate: restricted.command((input) => {
      const change = normalizeMemoryMutation(input);
      return run(
        "mutate",
        undefined,
        async (access) => {
          // Scope is immutable. Native CAS pins the authorized row through dispatch.
          const snapshot = await memory.queries.inspect(change.memoryId, access.signal);
          if (!snapshot) throw new AppError("memory/conflict", "Memory no longer exists");
          checkRecord(snapshot.memory);
          if (snapshot.revision !== change.expectedRevision)
            throw new AppError("memory/conflict", "Memory changed before submission");
          access.signal.throwIfAborted();
          return commands.mutate(change, access.signal);
        },
        undefined,
        "write",
      );
    }),
    classify: restricted.command((input) => {
      const change = normalizeBookClassification(input);
      return run("classify", change.bookId, (access) => commands.classify(change, access.signal), undefined, "write");
    }),
    context: {
      capture: restricted.command((input, options) => {
        const selector = contextBundleSelector(input),
          bookId = recipeBook(selector);
        return run(
          "context.capture",
          bookId,
          async (access) => {
            const receipt = await commands.context.capture(selector, access.signal);
            checkBundle(receipt.bundle, selector);
            return receipt;
          },
          options,
          "write",
        );
      }),
    },
    startGraphTask: restricted.command((bookId, mode, input) => {
      if (!canGenerate) throw new AppError("memory/forbidden", "Graph generation requires service:llm");
      const options = normalizeBookGraphTaskOptions(input);
      return run(
        "startGraphTask",
        bookId,
        (access) => commands.startGraphTask(bookId, mode, options, access),
        undefined,
        "task",
      );
    }),
    retryGraphTask: restricted.command((bookId, taskId, input) => {
      if (!canGenerate) throw new AppError("memory/forbidden", "Graph generation requires service:llm");
      const options = input === undefined ? undefined : normalizeBookGraphTaskOptions(input);
      return run(
        "retryGraphTask",
        bookId,
        (access) => commands.retryGraphTask(bookId, taskId, options, access),
        undefined,
        "task",
      );
    }),
    cancelGraphTask: restricted.command((bookId, taskId) =>
      run("cancelGraphTask", bookId, () => commands.cancelGraphTask(bookId, taskId), undefined, "write"),
    ),
  });
  const surface: PluginMemory = restrictSurface<PluginMemory>(lifecycle, "domains.memory", {
    queries: queryPolicy,
    events: {
      observe: restricted.observe((input, handler) => {
        const query = normalizeMemoryObservation(input);
        if (query.kind === "profile" || query.kind === "profileContext") denied(query.kind);
        if (typeof handler !== "function")
          throw new AppError("memory/invalid-query", "Expected an observation callback");
        return () => {
          let pending: PluginBookAccessFence | undefined,
            disposed = false;
          const stop = memory.events.observe(
            query,
            async (event) => {
              try {
                if (event.status === "ready") {
                  await pending?.assertUnchanged({ retain: true });
                  pending?.signal?.throwIfAborted();
                }
                if (!disposed) return await handler(event);
              } finally {
                pending?.dispose();
                pending = undefined;
              }
            },
            async (input) => {
              // Keep the poll's authority until delivery, closing the microtask gap
              // between a successful read and an asynchronous Worker callback.
              const bookId =
                input.kind === "search" || input.kind === "page"
                  ? scopeBook(input.query.scopes)
                  : "bookId" in input
                    ? input.bookId
                    : undefined;
              pending?.dispose();
              pending = await begin("observe", bookId);
              if (disposed) {
                pending.dispose();
                throw new AppError("memory/cancelled", "Memory observer retired");
              }
              try {
                return await readObservation(input);
              } catch (error) {
                pending?.dispose();
                pending = undefined;
                throw error;
              }
            },
          );
          return {
            dispose: () => {
              disposed = true;
              stop();
              pending?.dispose();
              pending = undefined;
            },
          };
        };
      }),
    },
    commands: memory.commands ? commandPolicy(memory.commands) : restricted.absent,
  });
  return surface;
}
