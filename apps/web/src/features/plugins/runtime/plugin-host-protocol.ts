import type { PluginContext, PluginManifest, PluginMigration } from "@read-aware/plugin-types";
import type { PLUGIN_PROTOCOL_VERSION } from "./plugin-worker-protocol";

/**
 * Messages the host sends a plugin Worker. Only the host can post to the
 * Worker, so the Worker does not re-validate them; the host validates what
 * the Worker sends, once, on receipt (plugin-worker-protocol.ts). Anything
 * that could forge a host message runs inside the same sandbox it would fool.
 */

export type ContextShape = { [key: string]: "fn" | ContextShape };
type Phase = PluginContext["lifecycle"]["phase"];
export type HostMessage =
  | {
      t: "boot";
      protocolVersion: typeof PLUGIN_PROTOCOL_VERSION;
      url: string;
      manifest: PluginManifest;
      appVersion: string;
      capabilities: PluginContext["capabilities"];
      grants: PluginContext["grants"];
      shape: ContextShape;
      storage: Record<string, string>;
      locale: string;
      phase: Phase;
      serviceId?: string;
    }
  | { t: "service"; id: number; serviceId: string; input: unknown }
  | { t: "invoke"; id: number; handle: string; args: unknown[] }
  | { t: "sync"; patch: { storage?: Record<string, string>; locale?: string; phase?: Phase } }
  | { t: "result"; id: number; ok: true; value: unknown; disposable?: string }
  | { t: "result"; id: number; ok: false; error: string; code?: string }
  | { t: "release"; handles: string[] }
  | { t: "health"; id: number }
  | { t: "migrate"; id: number; migration: PluginMigration }
  | { t: "quiesce" }
  | { t: "deactivate" };
