import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { CONTRIBUTION_CATALOG, normalizePluginContributionQuery, normalizeClipboardText, normalizeExternalUrl, normalizeHostExport, normalizePluginDirectoryQuery, type HostExportFile, type PluginDirectoryQuery, type PluginContributionQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { textResult } from "./tool-result";

export function buildHostIOTools(deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "list_plugin_contributions", label: "Registered plugin contributions",
    description: "Discover currently registered extension identities by contribution point or plugin ID: selection/header/context actions, commands, settings options, voices, content, reader modes, Agent tools/context/retrieval/memory candidates, themes/fonts and sync transports. Returns point/pluginId/key only, never callbacks, data, credentials or settings. Registered is not proof of readiness, visibility, permission or availability in this conversation. A key is not a universally callable handle or settings value; use the appropriate existing host tool and its authorization. Reads no provider data and invokes no plugin. Offset pages can change after registrations change; follow nextOffset, not requested limit.",
    parameters: Type.Object({ point: Type.Optional(Type.Union(Object.keys(CONTRIBUTION_CATALOG).map(point => Type.Literal(point)))),
      pluginId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })), search: Type.Optional(Type.String({ maxLength: 200 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const result = await deps.hostIO.listPluginContributions(normalizePluginContributionQuery(params as PluginContributionQuery));
      signal?.throwIfAborted(); return textResult(result);
    },
  }, {
    name: "list_installed_plugins", label: "Installed plugins",
    description: "Read a bounded public directory of installed plugins: ID, name, version, bundled/configured enabled state and activation failure flag. No secrets, settings, paths or raw errors. Enabled is configuration, not a health guarantee. Pages use offsets; restart pagination after installation or removal. Does not install, enable or invoke another plugin.",
    parameters: Type.Object({ search: Type.Optional(Type.String({ maxLength: 200 })), offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const result = await deps.hostIO.listPlugins(normalizePluginDirectoryQuery(params as PluginDirectoryQuery));
      signal?.throwIfAborted(); return textResult(result);
    },
  }, {
    name: "copy_to_clipboard", label: "Copy text",
    description: "Replace the system clipboard with the supplied text only when the user explicitly asks to copy it. Never reads the clipboard. Returns completion without repeating the text. Cancellation cannot undo an already dispatched clipboard write.",
    parameters: Type.Object({ text: Type.String({ maxLength: 1_000_000 }) }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      await deps.hostIO.writeClipboard(normalizeClipboardText((params as { text: unknown })?.text), signal);
      return textResult({ copied: true });
    },
  }, {
    name: "export_text_file", label: "Export text file",
    description: "Export supplied text through the host's native save dialog in response to the user's export request. The user chooses the destination; filename is only a suggested basename, never a filesystem path grant. A cancelled dialog returns saved:false. Does not export raw database data or read any file. Cancellation before the chosen file write prevents it; committed writes are not rolled back.",
    parameters: Type.Object({ filename: Type.String({ minLength: 1, maxLength: 256 }), content: Type.String({ maxLength: 1_000_000 }),
      mimeType: Type.Optional(Type.String({ maxLength: 256 })) }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => textResult({ saved: await deps.hostIO.exportFile(normalizeHostExport(params as HostExportFile), signal) }),
  }, {
    name: "open_external_url", label: "Open external link",
    description: "Open an HTTP(S) URL in the user's system browser only in response to an explicit request to open that destination. Never use this to transmit book text, credentials, memories or other private data through a URL. No file, data, javascript, custom application schemes or URL credentials. Completion means handed to the OS, not that the remote page loaded.",
    parameters: Type.Object({ url: Type.String({ minLength: 1, maxLength: 8192 }) }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      await deps.hostIO.openExternal(normalizeExternalUrl((params as { url: unknown })?.url), signal);
      return textResult({ dispatched: true });
    },
  }];
}
