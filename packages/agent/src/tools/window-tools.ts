import type { AgentTool } from "@earendil-works/pi-agent-core";
import { normalizeHostWindowRequest, type HostWindowRequest } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";
import { bool, lit, obj, oneOf, union } from "@earendil-works/pi-schema";

export function buildWindowTools(deps: RuntimeDeps): AgentTool[] {
  return [
    {
      name: "get_app_window",
      label: "App window",
      description:
        "Read the current main desktop window's minimized, maximized, fullscreen and focused flags. Unsupported previews return supported:false, not invented window state. Flags are sampled from the OS, not an atomic layout snapshot; no title, paths, geometry or other windows.",
      parameters: obj({}),
      execute: async (_id, _params, signal) => {
        signal?.throwIfAborted();
        const result = await deps.window.snapshot(signal);
        signal?.throwIfAborted();
        return textResult(result);
      },
    },
    {
      name: "control_app_window",
      label: "Control app window",
      description:
        "Only on the user's explicit window-management request: minimize, maximize, restore the normal visible window (leave fullscreen, unminimize, unmaximize), or set fullscreen. Never use to hide work or interrupt reading unsolicited. Main app window only; no close, quit, restart, arbitrary geometry or focus stealing. Requested means native commands acknowledged, not animation completion. Late cancellation does not undo dispatched changes; re-query state after transitions.",
      parameters: obj({
        request: union([
          obj({ action: oneOf(["minimize", "maximize", "restore"]) }),
          obj({ action: lit("fullscreen"), enabled: bool() }),
        ]),
      }),
      execute: async (_id, input, signal) => {
        signal?.throwIfAborted();
        const request = normalizeHostWindowRequest((input as { request: HostWindowRequest }).request);
        const result = await deps.window.control(request, signal);
        signal?.throwIfAborted();
        return textResult(result);
      },
    },
  ];
}
