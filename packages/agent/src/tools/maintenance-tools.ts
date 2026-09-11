import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, HOST_MAINTENANCE_SURFACES, type HostMaintenanceSurface } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";

export function buildMaintenanceTools(deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "request_ai_connection_test", label: "Request AI connection test", executionMode: "sequential",
    description: "Only on explicit user request, reveal the native AI Test connection button and wait for the user to click it. Never clicks, submits credentials or receives endpoint, key, model identity or response text. Tests the primary model using the user's current native form and existing inference policy; may incur provider charges. Returns responded/empty/cancelled; responded only means one nonempty test reply, not all models/features, persistent configuration or future availability. Failure rejects. Editing the configuration during the test invalidates its result. Cancellation/unmount before click prevents this request from starting; an already-started provider call is not physically cancelled or refunded. No automatic test, hidden billing or arbitrary destination.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (_id, _params, signal) => {
      signal?.throwIfAborted();
      const result = await deps.maintenance.requestConnectionTest(signal);
      signal?.throwIfAborted(); return textResult(result);
    },
  }, {
    name: "request_backup", label: "Request backup action", executionMode: "sequential",
    description: "Only on explicit user request, reveal the native backup import or export button and wait for the user to click it and use the file dialog. Never clicks, chooses paths or receives backup bytes. Returns imported/exported/cancelled only after that host flow settles; imported does not prove reload/genesis completed. The existing v1 backup includes KV, books, collections, annotations and original files, NOT the complete event log, independent AI/memory/plugin document stores or secrets. Import merges and can overwrite existing records; failures can leave partial writes. Cancellation before merging prevents it; after merging starts it cannot roll back. No silent restore, full-backup guarantee or arbitrary file access.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("import"), Type.Literal("export")]) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const action = (params as { action: "import" | "export" }).action;
      if (action !== "import" && action !== "export") throw new AppError("ui/invalid-target", "Invalid backup action");
      const result = await deps.maintenance.requestBackup(action, signal);
      signal?.throwIfAborted(); return textResult(result);
    },
  }, {
    name: "verify_local_data", label: "Verify local data", executionMode: "sequential",
    description: "Only when the user requests a local data integrity check, replay the complete local event log and compare its projections, then roll back the diagnostic replay. Returns consistency and aggregate counts only, never row samples, table names, logs, paths or user content. This can occupy the local database while checking. No repairs, network, backup validation, sync trigger or guarantee about other devices. An incomplete backfill or read failure throws, never reports consistent. Cancellation stops this caller's wait; the shared native check must finish and roll back.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (_id, _params, signal) => {
      signal?.throwIfAborted();
      const result = await deps.diagnostics.verifyProjections(signal);
      signal?.throwIfAborted(); return textResult(result);
    },
  }, {
    name: "request_diagnostics_report", label: "Request diagnostic report", executionMode: "sequential",
    description: "On explicit user request, open a host-owned diagnostic bundle preview for export or send. Logs and integrity samples can contain personal data; the user must inspect and confirm in the native UI. Never receives the bundle, logs, file path or report ID. exported means the save completed; sent means the report endpoint acknowledged it, not that developers reviewed it. cancelled means no confirmed completion. Cancellation closes an unconfirmed flow but cannot undo a confirmed save/upload. No automatic sending, repairs, arbitrary recipient or raw diagnostics access.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("export"), Type.Literal("send")]) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const action = (params as { action: "export" | "send" }).action;
      if (action !== "export" && action !== "send") throw new AppError("ui/invalid-target", "Unknown diagnostic report action");
      const receipt = await deps.diagnostics.requestReport(action, signal);
      signal?.throwIfAborted(); return textResult(receipt);
    },
  }, {
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
    description: "In response to the user's request, reveal the host update, diagnostics, plugin management, backup import/export, local data directory or deletion controls. opened means the target controls are mounted and revealed, NOT that anything was installed, enabled, uninstalled, exported, imported, deleted or sent. data-location shows the directory only in host UI; the user must click Reveal to open the system file manager. The path is never returned to the model. The user must act on the host controls: plugin install permissions, file selection, diagnostics confirmation and the typed DELETE data-wipe confirmation cannot be bypassed. delete-data reveals the entry button; it does not open or approve the dialog. Backup is the existing v1 subset, not a complete event-log/AI/secret backup. No raw paths, payloads or silent destructive authority are returned.",
    parameters: Type.Object({ surface: Type.Union(HOST_MAINTENANCE_SURFACES.map(surface => Type.Literal(surface))) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      const surface = (params as { surface: HostMaintenanceSurface }).surface;
      if (!HOST_MAINTENANCE_SURFACES.includes(surface)) throw new AppError("ui/invalid-target", "Unknown maintenance surface");
      return textResult(await deps.maintenance.openSettings(surface, signal));
    },
  }];
}
