import type { AgentTool } from "@earendil-works/pi-agent-core";
import { HOST_COMMAND_IDS, normalizeOperationAvailability, operationAvailability } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { bool, int, lit, obj, oneOf, opt, str, union, unknown } from "@earendil-works/pi-schema";

export function buildOperationAvailabilityTools(deps: RuntimeDeps, scope: ThreadScope): AgentTool[] {
  return [
    {
      name: "get_operation_availability",
      label: "Operation prerequisites",
      description:
        "Inspect current prerequisites without executing: resources.save and resources.openAssociated require resourceId owned by this conversation; save optionally accepts filename. Checks sealing, authorization and host entry without saving or opening. Destination or associated app remains unverified. schedules.control requires schedule {pluginId,id,action:pause/resume/run}; global scope only, checks binding, persistence and execution capacity without running a callback. Paused schedules can still run manually. settings.refreshModelCatalog requires provider; checks public catalog support and shared refresh status, without credentials or a network probe. llm.infer accepts model/images; reading.playback requires bookId and action start/stop; reading.mode.configure requires bookId and active, and accepts modeKey/selectModeKey/unitId as in configure_reading_mode. Reading queries optionally bind sessionId. library.text.prepare requires bookId and accepts rebuild/priority/timeoutMs as in prepare_book_text; inspects this actor's task capacity, rebuild conflict, source/provider and missing-file retrieval conditions without loading content or downloading. All book targets stay within this tool's book scope. Returns no text, credentials or provider addresses. unknown is unverified and permits trying; execution rechecks. sync.now takes no other fields and checks local sync connection, credentials and registered transport without connecting or probing. memory.graph.generate requires bookId and mode catch-up/rebuild, with optional maxChapters; checks actor capacity, persisted chapter boundary and fast model without extraction, classification or inference. window.control requires a nested request with action minimize/maximize/restore, or action fullscreen and enabled boolean; inspects desktop support, queue and current target state without changing the window. clipboard.writeText requires text; ui.openExternal requires url. These validate bounded inputs and local entry availability without copying, opening or probing. ui.exportFile requires filename and byteLength (UTF-8 size for text, at most 64 MiB), with optional mimeType; inspects metadata and save entry without content, temporary files or a dialog. OS access remains unknown until execution. plugins.callService requires serviceCall with a discovered service reference, optional bookId and JSON input. Checks contract, shared authority and capacity without invoking or requesting approval; Agent calls still require separate user approval. ui.commands.execute requires command matching execute_host_command; inspects permissions, workspace revision and selection limits without saving or navigation. Target loading and UI commit remain unverified. maintenance.checkForUpdates takes no other fields and checks native updater support and the shared check/install lock without contacting the update server. diagnostics.verifyProjections takes no other fields and checks native support and shared replay admission without replaying data; log completeness remains unknown until execution. Host flow queries: maintenance.requestBackup requires action import/export; diagnostics.requestReport requires action export/send; maintenance.requestConnectionTest and diagnostics.requestProjectionRepair take no other fields. Inspect desktop support and flow occupancy without navigation, backup, reporting, inference or repair. Native controls and user confirmation remain unknown; querying grants no confirmation authority. sync.requestFlow requires flow with action connect/disconnect/delete-account/upgrade/billing and optional transportRef for connect only. Checks local account/backend, registered transport, flow occupancy and purchase availability without requesting a flow. Remote status and native controls remain unverified. Other operations retain their own checks.",
      parameters: obj({
        operation: oneOf([
          "resources.save",
          "resources.openAssociated",
          "schedules.control",
          "settings.refreshModelCatalog",
          "llm.infer",
          "reading.playback",
          "reading.mode.configure",
          "library.text.prepare",
          "sync.now",
          "sync.requestFlow",
          "maintenance.checkForUpdates",
          "diagnostics.verifyProjections",
          "maintenance.requestBackup",
          "maintenance.requestConnectionTest",
          "diagnostics.requestReport",
          "diagnostics.requestProjectionRepair",
          "memory.graph.generate",
          "window.control",
          "clipboard.writeText",
          "ui.openExternal",
          "ui.exportFile",
          "plugins.callService",
          "ui.commands.execute",
        ]),
        resourceId: opt(str({ minLength: 1, maxLength: 256 })),
        schedule: opt(
          obj({
            pluginId: str({ minLength: 1, maxLength: 256 }),
            id: str({ minLength: 1, maxLength: 256 }),
            action: oneOf(["pause", "resume", "run"]),
          }),
        ),
        provider: opt(str({ minLength: 1, maxLength: 128 })),
        flow: opt(
          obj({
            action: oneOf(["connect", "disconnect", "delete-account", "upgrade", "billing"]),
            transportRef: opt(str({ minLength: 1, maxLength: 256 })),
          }),
        ),
        command: opt(
          obj({
            id: oneOf(HOST_COMMAND_IDS),
            args: opt(
              obj({
                bookId: opt(str({ maxLength: 256 })),
                collectionId: opt(str({ maxLength: 256 })),
              }),
            ),
            expectedWorkspaceRevision: opt(int({ minimum: 0 })),
          }),
        ),
        serviceCall: opt(
          obj({
            service: obj({
              pluginId: str({ maxLength: 64 }),
              id: str({ maxLength: 64 }),
              version: str({ maxLength: 128 }),
              generation: str({ maxLength: 80 }),
            }),
            bookId: opt(str({ maxLength: 256 })),
            input: unknown(),
          }),
        ),
        filename: opt(str({ minLength: 1, maxLength: 256 })),
        byteLength: opt(int({ minimum: 0, maximum: 67108864 })),
        mimeType: opt(str({ maxLength: 256 })),
        text: opt(str({ maxLength: 1_000_000 })),
        url: opt(str({ minLength: 1, maxLength: 8192 })),
        request: opt(
          union([
            obj({ action: oneOf(["minimize", "maximize", "restore"]) }),
            obj({ action: lit("fullscreen"), enabled: bool() }),
          ]),
        ),
        mode: opt(oneOf(["catch-up", "rebuild"])),
        maxChapters: opt(int({ minimum: 1, maximum: 1000 })),
        model: opt(oneOf(["fast", "smart"])),
        images: opt(bool()),
        bookId: opt(str({ minLength: 1, maxLength: 512 })),
        sessionId: opt(str({ minLength: 1, maxLength: 512 })),
        action: opt(oneOf(["start", "stop", "import", "export", "send"])),
        active: opt(bool()),
        modeKey: opt(str({ minLength: 1, maxLength: 512 })),
        selectModeKey: opt(str({ minLength: 1, maxLength: 512 })),
        unitId: opt(str({ minLength: 1, maxLength: 512 })),
        rebuild: opt(bool()),
        priority: opt(oneOf(["normal", "background"])),
        timeoutMs: opt(int({ minimum: 1000, maximum: 7200000 })),
      }),
      execute: async (_id, input, signal) => {
        const query = normalizeOperationAvailability(input);
        signal?.throwIfAborted();
        if (scope.kind === "book" && query.operation === "schedules.control")
          return textResult(
            operationAvailability(query, [
              { kind: "permission", state: "unavailable", reason: "global-scope-required" },
            ]),
          );
        if (query.operation === "resources.save" || query.operation === "resources.openAssociated") {
          const conditions = await deps
            .resources(threadScopeKey(scope), scope.kind === "book" ? scope.bookId : undefined)
            .conditions(query, signal);
          signal?.throwIfAborted();
          return textResult(operationAvailability(query, conditions));
        }
        const targetBook =
          query.operation === "plugins.callService"
            ? query.serviceCall.bookId
            : "bookId" in query
              ? query.bookId
              : undefined;
        if (
          scope.kind === "book" &&
          ("bookId" in query || query.operation === "plugins.callService") &&
          targetBook !== scope.bookId
        ) {
          return textResult(
            operationAvailability(query, [{ kind: "permission", state: "unavailable", reason: "book-scope-required" }]),
          );
        }
        const snapshot = deps.operationAvailability
          ? await deps.operationAvailability.check(query, signal)
          : operationAvailability(query, [
              { kind: "provider", state: "unknown", reason: "host-prerequisites-unavailable" },
            ]);
        signal?.throwIfAborted();
        return textResult(snapshot);
      },
    },
  ];
}
