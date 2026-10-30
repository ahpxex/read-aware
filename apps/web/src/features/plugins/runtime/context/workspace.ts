import { stampEventCause } from "../../../../platform/domain-actor";
import { scopePluginWorkspace } from "../plugin-scoped-workspace";
import { workspace } from "../../../../services/workspace";
import { actorHostCommands } from "../../../../services/host-command-runtime";
import type { PluginContext } from "../../lib/plugin-types";
import { readingRuntime } from "../../../../domain/reading-runtime";
import type { PluginActorKit } from "./kit";

/** Workspace navigation and host commands, which require the library domain. */
export function installWorkspaceServices(
  kit: PluginActorKit,
  ctx: PluginContext,
  library: NonNullable<PluginActorKit["domain"]["library"]>,
): void {
  const {
    lifecycle,
    currentBook,
    objectAccess,
    scopedWorkspaceState,
    operationActor,
    domain,
    settingsDomain,
    track,
    availability,
  } = kit;
  const commands = actorHostCommands(
    settingsDomain,
    true,
    !!library.commands,
    !!domain.reading?.commands,
    operationActor,
  );
  availability.command = commands.check;
  ctx.services.ui.commands = {
    observe: (handler) => track(() => ({ dispose: commands.observe(handler) })),
    list: async () => {
      lifecycle.assertActive("services.ui.commands.list");
      return commands.list(lifecycle.signal);
    },
    ...(library.commands
      ? {
          execute: (request: import("@read-aware/core").HostCommandRequest) => {
            lifecycle.assertActive("services.ui.commands.execute");
            return commands.execute(request, lifecycle.signal);
          },
        }
      : {}),
  };
  ctx.services.ui.workspace = {
    snapshot: async (query) => {
      lifecycle.assertActive("services.ui.workspace.snapshot");
      return workspace.snapshot(query);
    },
    observe: (query, handler) =>
      track(() => ({ dispose: workspace.observe(query, handler, undefined, operationActor) })),
    ...(library.commands
      ? {
          navigate: (target: import("@read-aware/core").WorkspaceTarget, expectedRevision?: number) => {
            lifecycle.assertActive("services.ui.workspace.navigate");
            return workspace.navigate(
              target,
              expectedRevision,
              lifecycle.signal,
              !!domain.reading?.commands,
              undefined,
              operationActor,
            );
          },
        }
      : {}),
  };
  if (objectAccess.restricted) {
    const scoped = scopePluginWorkspace(
      workspace,
      commands,
      objectAccess,
      lifecycle,
      {
        current: () => currentBook(),
        observe: (handler) => {
          let initial = true;
          return readingRuntime.observe((snapshot) => {
            const source = initial ? stampEventCause({}, operationActor) : snapshot;
            initial = false;
            return handler(source);
          });
        },
      },
      !!library.commands,
      !!domain.reading?.commands,
      scopedWorkspaceState,
      operationActor,
    );
    availability.command = scoped.checkCommand;
    ctx.services.ui.commands = scoped.commands;
    ctx.services.ui.workspace = scoped.workspace;
  }
}
