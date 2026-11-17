import { observeSnapshot } from "../../../domain/snapshot-observation";
import { stampEventCause, copyEventCause, type DomainActor } from "../../../platform/domain-actor";
import {
  AppError,
  errorCode,
  normalizeHostCommandRequest,
  normalizeWorkspaceQuery,
  normalizeWorkspaceTarget,
  type HostCommandSnapshot,
  type HostCommandRequest,
  type OperationAvailability,
  operationAvailability,
  type WorkspaceQuery,
  type WorkspaceSnapshot,
  type WorkspaceTarget,
} from "@read-aware/core";
import type { PluginContext } from "@read-aware/plugin-types";
import {
  pluginObjectAccessDenied,
  runFenced,
  type CurrentBookSnapshot,
  type PluginBookAccessPolicy,
} from "../../../domain/plugin-object-access";
import type { WorkspaceService, WorkspaceView } from "../../../services/workspace";
import type { actorHostCommands } from "../../../services/host-command-runtime";
import { createLogger } from "../../../platform/logger";
import type { PluginLifecycleController } from "./plugin-lifecycle";
import { settled } from "../../../platform/write-settlement";

type Ui = PluginContext["services"]["ui"];
type Reader = { current(): CurrentBookSnapshot; observe(handler: (source?: object) => void): () => void };
const log = createLogger("scoped-workspace");

/** The host retains its complete selection; only the authorized projection and
 * an actor-local concurrency token cross the plugin boundary. */
export function scopePluginWorkspace(
  host: WorkspaceService,
  hostCommands: ReturnType<typeof actorHostCommands>,
  policy: PluginBookAccessPolicy,
  lifecycle: PluginLifecycleController,
  reader: Reader,
  canNavigate: boolean,
  canCloseReader: boolean,
  state: { revision: number; nativeRevision?: number; scopeKey?: string } = { revision: 0 },
  origin: DomainActor = "system",
): Pick<Ui, "workspace" | "commands"> & {
  checkCommand(request: HostCommandRequest, signal?: AbortSignal): Promise<OperationAvailability>;
} {
  const denied = (operation: string): never => {
    throw pluginObjectAccessDenied(`workspace.${operation}`);
  };
  const bookId = () => (policy.grant.mode === "book" ? policy.grant.bookId : reader.current().bookId);
  const project = (view: WorkspaceView): WorkspaceView => {
    const id = bookId();
    return {
      ...view,
      scope: { bookId: id, withheld: ["collectionId", "search.query"] },
      collectionId: null,
      search: { ...view.search, query: "" },
      selection: { active: view.selection.active, bookIds: view.selection.bookIds.filter((value) => value === id) },
    };
  };
  const stamp = (snapshot: WorkspaceSnapshot): WorkspaceSnapshot => {
    const key = JSON.stringify([bookId(), policy.grant.mode === "current" ? reader.current().sessionId : null]);
    if (state.nativeRevision !== snapshot.revision || state.scopeKey !== key) {
      state.revision++;
      state.nativeRevision = snapshot.revision;
      state.scopeKey = key;
    }
    return copyEventCause(snapshot, { ...snapshot, revision: state.revision });
  };
  const capture = (query?: WorkspaceQuery) => stamp(host.snapshot(query, project));
  const expectedNative = (expected?: number) => {
    capture({ limit: 1 });
    if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0))
      throw new AppError("ui/invalid-target", "Invalid workspace revision");
    if (expected !== undefined && expected !== state.revision)
      throw new AppError("ui/superseded", "Workspace changed since discovery");
    return state.nativeRevision!;
  };
  const normalizeTarget = (input: WorkspaceTarget) => {
    const target = normalizeWorkspaceTarget(input);
    if (target.surface === "shelf") {
      if (target.collectionId !== null) denied("collection navigation");
      for (const id of target.selection?.bookIds ?? []) policy.assertBook(id, "workspace selection");
    }
    return target;
  };
  const checkClosing = () => {
    const current = reader.current();
    if (current.bookId !== null) policy.assertBook(current.bookId, "workspace reader close");
  };
  const waitForWork = <T>(work: Promise<T>) => {
    lifecycle.trackCleanup(settled(work));
    return work;
  };

  async function navigate<T>(
    operation: string,
    closes: boolean,
    work: (signal: AbortSignal) => Promise<T>,
    openBook?: string,
  ) {
    lifecycle.assertActive(operation);
    if (openBook !== undefined) {
      const fence = await policy.beginBook(openBook, operation, { allowSessionChange: true });
      const before = reader.current(),
        changed = new AbortController();
      const check = () => {
        const after = reader.current();
        if (
          (after.bookId === before.bookId && after.sessionId === before.sessionId) ||
          after.bookId === openBook ||
          after.bookId === null
        )
          return;
        changed.abort(pluginObjectAccessDenied("workspace reader changed before open"));
      };
      const off = reader.observe(check);
      try {
        const signal = AbortSignal.any([lifecycle.signal, changed.signal, ...(fence.signal ? [fence.signal] : [])]);
        check();
        signal.throwIfAborted();
        const result = await waitForWork(work(signal));
        signal.throwIfAborted();
        await fence.assertUnchanged();
        return result;
      } finally {
        off();
        fence.dispose();
      }
    }
    if (closes) checkClosing();
    const before = reader.current(),
      controller = new AbortController();
    const check = () => {
      const after = reader.current();
      if ((before.bookId === after.bookId && before.sessionId === after.sessionId) || (closes && after.bookId === null))
        return;
      controller.abort(pluginObjectAccessDenied("workspace reader changed"));
    };
    const off = reader.observe(check);
    const signal = AbortSignal.any([lifecycle.signal, controller.signal]);
    try {
      check();
      signal.throwIfAborted();
      const result = await waitForWork(work(signal));
      signal.throwIfAborted();
      return result;
    } finally {
      off();
    }
  }
  const list = async (signal: AbortSignal = lifecycle.signal): Promise<HostCommandSnapshot> => {
    lifecycle.assertActive("ui.commands.list");
    const snapshot = await hostCommands.list(signal);
    signal.throwIfAborted();
    let actorRevision: number | null = null;
    if (snapshot.workspaceRevision !== null) {
      const snapshotState = capture({ limit: 1 });
      if (state.nativeRevision !== snapshot.workspaceRevision)
        throw new AppError("ui/superseded", "Workspace changed during command discovery");
      actorRevision = snapshotState.revision;
    }
    return {
      ...snapshot,
      workspaceRevision: actorRevision,
      commands: snapshot.commands.map((command) => {
        let outside = command.id === "open-collection" || (command.id === "open-book" && bookId() === null);
        if (command.id !== "open-book" && command.id !== "open-settings") {
          try {
            checkClosing();
          } catch {
            outside = true;
          }
        }
        return outside && command.enabled
          ? { ...command, enabled: false, unavailableReason: "object-scope" as const }
          : command;
      }),
    };
  };

  return {
    async checkCommand(input, signal = lifecycle.signal) {
      lifecycle.assertActive("ui.commands.check");
      signal.throwIfAborted();
      const request = normalizeHostCommandRequest(input);
      const authorize = () => {
        if (!canNavigate || request.id === "open-collection") denied(request.id);
        if (request.id === "open-book") policy.assertBook(request.args.bookId, "workspace open-book");
        if (request.id !== "open-settings" && request.id !== "open-book") checkClosing();
      };
      try {
        authorize();
        await list(signal);
        signal.throwIfAborted();
        authorize();
        const result = await hostCommands.check(
          { ...request, expectedWorkspaceRevision: expectedNative(request.expectedWorkspaceRevision) },
          signal,
        );
        signal.throwIfAborted();
        authorize();
        return result;
      } catch (error) {
        signal.throwIfAborted();
        const code = errorCode(error) ?? "internal",
          permission = code === "plugin/object-access-denied";
        if (!permission && code !== "ui/superseded") log.warn("Cannot inspect scoped command", error);
        return operationAvailability({ operation: "ui.commands.execute", command: request }, [
          {
            kind: permission ? "permission" : "object",
            state: permission || code === "ui/superseded" ? "unavailable" : "unknown",
            reason: permission ? "book-scope-required" : "command-prerequisites-read-failed",
            errorCode: code,
          },
        ]);
      }
    },
    workspace: {
      async snapshot(input) {
        lifecycle.assertActive("ui.workspace.snapshot");
        const query = normalizeWorkspaceQuery(input),
          id = bookId();
        if (query.selectionAfter !== undefined) policy.assertBook(query.selectionAfter, "workspace selection cursor");
        if (id === null) return capture(query);
        return runFenced(policy.beginBook(id, "workspace.snapshot"), async () => capture(query));
      },
      observe(input, handler) {
        const query = normalizeWorkspaceQuery(input);
        if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected a workspace callback");
        if (query.selectionAfter !== undefined) policy.assertBook(query.selectionAfter, "workspace selection cursor");
        return lifecycle.stage(() => ({
          dispose: observeSnapshot(
            () => {
              try {
                return stamp(host.snapshot(query, project));
              } catch (error) {
                if (errorCode(error) === "ui/unavailable") return null;
                throw error;
              }
            },
            (notify) => {
              const offHost = host.observe(query, (_value, source) => notify(source), project, origin);
              try {
                const offReader = reader.observe((source) => notify(source ?? stampEventCause({}, "system")));
                return () => {
                  offHost();
                  offReader();
                };
              } catch (error) {
                offHost();
                throw error;
              }
            },
            handler,
            (error) => log.warn("Workspace scope observation failed", error),
            origin,
          ),
        }));
      },
      ...(canNavigate
        ? {
            navigate(input: WorkspaceTarget, expectedRevision?: number) {
              const target = normalizeTarget(input);
              return navigate(
                "ui.workspace.navigate",
                target.surface !== "settings" && target.surface !== "search",
                async (signal) => {
                  const expected = expectedNative(expectedRevision);
                  const result = await host.navigate(target, expected, signal, canCloseReader, project, origin);
                  return { ...result, snapshot: stamp(result.snapshot) };
                },
              );
            },
          }
        : {}),
    },
    commands: {
      list: () => lifecycle.read("ui.commands.list", (signal) => list(signal)),
      observe: (handler) => lifecycle.stage(() => ({ dispose: hostCommands.observe(handler, list, reader.observe) })),
      ...(canNavigate
        ? {
            execute(input: import("@read-aware/core").HostCommandRequest) {
              const request = normalizeHostCommandRequest(input);
              if (request.id === "open-collection") denied("open-collection");
              if (request.id === "open-book") policy.assertBook(request.args.bookId, "workspace open-book");
              return navigate(
                "ui.commands.execute",
                request.id !== "open-settings" && request.id !== "open-book",
                async (signal) => {
                  const snapshot = await list(signal),
                    command = snapshot.commands.find((value) => value.id === request.id)!;
                  if (command.unavailableReason === "object-scope") denied(request.id);
                  const expected = expectedNative(request.expectedWorkspaceRevision);
                  return hostCommands.execute({ ...request, expectedWorkspaceRevision: expected }, signal);
                },
                request.id === "open-book" ? request.args.bookId : undefined,
              );
            },
          }
        : {}),
    },
  };
}
