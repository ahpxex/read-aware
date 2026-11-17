import type { AgentTool } from "@earendil-works/pi-agent-core";
import { AppError } from "@read-aware/core";
import type { ReaderToolContext, RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import type { AgentTurnState } from "./turn-state";

export type ToolAvailability = { state: "available" | "unavailable" | "unknown"; reason?: string };
const metadata = new WeakMap<AgentTool, ToolAvailability>();
export const toolAvailability = (tool: AgentTool): ToolAvailability | undefined => metadata.get(tool);
export const setToolAvailability = (tool: AgentTool, availability: ToolAvailability): void => {
  metadata.set(tool, availability);
};
/** A reader capability a tool needs beyond an active, loaded session. */
export type ReaderNeed = "selection" | "controls" | "panels" | "modes" | "playback";

/**
 * What a tool needs from the host before it can run, declared where the tool
 * is defined (`requires`). A tool without a declaration is always available;
 * input-specific checks stay in the tool itself.
 */
export type ToolReadiness =
  | { kind: "web"; operation: "search" | "fetch" }
  | { kind: "image-input" }
  | { kind: "image-viewer" }
  | {
      kind: "reader";
      needs?: readonly ReaderNeed[];
      /** Navigation also owns close and reload, so it stays available while the reader loads or fails. */
      whileLoading?: boolean;
    };

const readiness = new WeakMap<AgentTool, ToolReadiness>();
/** Declare a tool's host readiness at its definition. */
export function requires<T extends AgentTool>(tool: T, need: ToolReadiness): T {
  readiness.set(tool, need);
  return tool;
}

const available: ToolAvailability = { state: "available" };
const unavailable = (reason: string): ToolAvailability => ({ state: "unavailable", reason });

function readContext(deps: RuntimeDeps): ReaderToolContext | null | undefined {
  if (!deps.reader.toolContext) return undefined;
  try {
    return deps.reader.toolContext();
  } catch (error) {
    // Reported to the model as host-readiness-failed; the cause belongs in the log.
    deps.log?.warn("reader tool readiness unavailable", error);
    return null;
  }
}
function check(
  need: ToolReadiness | undefined,
  scope: ThreadScope,
  deps: RuntimeDeps,
  context: ReturnType<typeof readContext>,
  turnState?: AgentTurnState,
): ToolAvailability {
  if (!need) return available;
  if (need.kind === "web")
    return deps.web?.configured(need.operation)
      ? available
      : unavailable("search-not-configured-or-provider-unsupported; check the selected provider in Settings → AI");
  if (need.kind === "image-input")
    return !deps.bookText.readImageInput
      ? unavailable("image-input-unavailable")
      : turnState?.modelSupportsImages === false
        ? unavailable("model-image-unsupported")
        : available;
  const selection = need.kind === "reader" && need.needs?.includes("selection");
  if (
    selection &&
    (turnState?.readingContextPermissions?.selection === false ||
      deps.readingContextPolicy?.snapshot().selection === false)
  )
    return unavailable("selection-private");
  if (context === undefined) return { state: "unknown", reason: "host-readiness-unavailable" };
  if (context === null) return unavailable("host-readiness-failed");
  if (need.kind === "image-viewer")
    return !context.imageBookId
      ? unavailable("no-image-viewer")
      : scope.kind === "book" && context.imageBookId !== scope.bookId
        ? unavailable("scope-not-active")
        : available;
  if (!context.session || !context.bookId) return unavailable("no-reader-session");
  if (scope.kind === "book" && context.bookId !== scope.bookId) return unavailable("scope-not-active");
  if (need.whileLoading) return available;
  if (!context.ready) return unavailable("reader-not-ready");
  const missing: Record<ReaderNeed, string> = {
    selection: "no-selection",
    controls: "no-reader-controls",
    panels: "no-reader-panels",
    modes: "no-reading-mode",
    playback: "read-aloud-unavailable",
  };
  for (const item of need.needs ?? []) if (!context[item]) return unavailable(missing[item]);
  return available;
}

/** All host tools share metadata semantics. Input-specific objects, permissions,
 * approval and per-action readiness remain authoritative in their domain calls.
 * Do not wrap extensions: their registration identity and availability are owned
 * by the plugin bridge, not a same-name host mapping. */
export function prepareHostTools(
  tools: AgentTool[],
  scope: ThreadScope,
  deps: RuntimeDeps,
  turnState?: AgentTurnState,
) {
  const context = readContext(deps);
  const all = tools.map((tool) => {
    const need = readiness.get(tool);
    const wrapped: AgentTool = {
      ...tool,
      execute: async (...args) => {
        args[2]?.throwIfAborted();
        const current = check(need, scope, deps, readContext(deps), turnState);
        if (current.state === "unavailable")
          throw new AppError("ui/unavailable", `Tool is currently unavailable: ${current.reason}`);
        return tool.execute(...args);
      },
    };
    metadata.set(wrapped, check(need, scope, deps, context, turnState));
    return wrapped;
  });
  return { enabled: all.filter((tool) => toolAvailability(tool)?.state !== "unavailable"), all };
}
