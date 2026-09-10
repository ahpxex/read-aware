import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, HOST_MAINTENANCE_SURFACES, type HostMaintenanceSurface } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";

export function buildMaintenanceTools(deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "get_software_update", label: "Software update status",
    description: "Read the host updater state and selected/last-checked channels without network access. Set check:true only when the user requests a fresh check of the host release feed. A failed check throws; it never means up to date. Unsupported platforms cannot check. Current version can be unknown. No download, install, restart, credentials, logs or custom URL access. Cancellation does not stop another caller's shared check.",
    parameters: Type.Object({ check: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const result = (params as { check?: boolean }).check
        ? await deps.maintenance.checkForUpdates(signal) : await deps.maintenance.snapshot();
      signal?.throwIfAborted(); return textResult(result);
    },
  }, {
    name: "open_maintenance_settings", label: "Open maintenance controls", executionMode: "sequential",
    description: "In response to the user's request, reveal the host update, diagnostics, plugin management, backup import/export or local data deletion controls. opened means the target controls are mounted and revealed, NOT that anything was installed, enabled, uninstalled, exported, imported, deleted or sent. The user must act on the host controls: plugin install permissions, file selection, diagnostics confirmation and the typed DELETE data-wipe confirmation cannot be bypassed. delete-data reveals the entry button; it does not open or approve the dialog. Backup is the existing v1 subset, not a complete event-log/AI/secret backup. No raw paths, payloads or silent destructive authority are returned.",
    parameters: Type.Object({ surface: Type.Union(HOST_MAINTENANCE_SURFACES.map(surface => Type.Literal(surface))) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      const surface = (params as { surface: HostMaintenanceSurface }).surface;
      if (!HOST_MAINTENANCE_SURFACES.includes(surface)) throw new AppError("ui/invalid-target", "Unknown maintenance surface");
      return textResult(await deps.maintenance.openSettings(surface, signal));
    },
  }];
}
