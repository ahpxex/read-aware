import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";

export function buildEnvironmentTools(deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "get_host_environment", label: "Host environment",
    description: "Read current app locale, detected desktop platform, timezone and UTC offset, runtime shell, and OS/WebView network hint. This does not probe endpoint reachability, infer account/model readiness, or expose reading state. Versioned snapshots refresh on every query.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (_id, _params, signal) => {
      if (signal?.aborted) throw signal.reason;
      const snapshot = await deps.environment.snapshot();
      if (signal?.aborted) throw signal.reason;
      return textResult(snapshot);
    },
  }];
}
