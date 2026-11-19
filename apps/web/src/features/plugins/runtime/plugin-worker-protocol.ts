import type { PluginReactionToken } from "@read-aware/plugin-types";
import { AppError } from "@read-aware/core";
import type { PluginCallbackWire } from "./plugin-callback-wire";
import { assertPluginWireBudget, PLUGIN_WIRE_LIMITS } from "./plugin-wire-budget";

/** Host and bundled sandbox ship together; incompatible transports fail closed. */
export const PLUGIN_PROTOCOL_VERSION = 1;
export type WorkerMessage =
  | { t: "hello"; protocolVersion: typeof PLUGIN_PROTOCOL_VERSION }
  | { t: "ready"; protocolVersion: typeof PLUGIN_PROTOCOL_VERSION; hasMigration: boolean }
  | { t: "failed"; error: string }
  | { t: "dispose"; handle: string }
  | { t: "call"; id: number; method: string; args: PluginCallbackWire; reaction?: PluginReactionToken }
  | { t: "cancel"; id: number }
  | { t: "result"; id: number; ok: true; value: PluginCallbackWire }
  /** `stack` is the Worker-side stack of the failure: plugin-controlled text, bounded and log-only. */
  | { t: "result"; id: number; ok: false; error: string; code?: string; stack?: string }
  | { t: "healthy"; id: number }
  | { t: "migrated"; id: number; ok: true }
  | { t: "migrated"; id: number; ok: false; error: string; stack?: string }
  | { t: "quiesced"; error?: string }
  /** The plugin's own deactivate() has settled; the host may terminate the Worker. */
  | { t: "deactivated" };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const string = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
export const validPluginCallId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
/** Failure cleanup reads only bounded handle metadata, never the rejected data graph. */
export function rejectedPluginCallbackHandles(value: unknown): string[] {
  if (!record(value)) return [];
  const payload = value.t === "call" ? value.args : value.t === "result" ? value.value : undefined;
  if (
    !record(payload) ||
    !Array.isArray(payload.callbacks) ||
    payload.callbacks.length > PLUGIN_WIRE_LIMITS.callbacksPerMessage
  )
    return [];
  return payload.callbacks.flatMap((entry) =>
    record(entry) &&
    typeof entry.handle === "string" &&
    entry.handle.length <= 17 &&
    /^h[1-9][0-9]{0,15}$/.test(entry.handle)
      ? [entry.handle]
      : [],
  );
}
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
/** The longest Worker-side stack a failure may carry. */
export const PLUGIN_FAILURE_STACK_MAX = 4096;
const stack = (value: Record<string, unknown>) =>
  value.stack === undefined || string(value.stack, PLUGIN_FAILURE_STACK_MAX);
const failure = (value: Record<string, unknown>) =>
  string(value.error, 4096) && (value.code === undefined || string(value.code, 256)) && stack(value);
function wire(value: unknown): value is PluginCallbackWire {
  if (
    !record(value) ||
    !keys(value, ["data", "callbacks"]) ||
    !Object.prototype.hasOwnProperty.call(value, "data") ||
    !Array.isArray(value.callbacks) ||
    value.callbacks.length > PLUGIN_WIRE_LIMITS.callbacksPerMessage
  )
    return false;
  return value.callbacks.every(
    (entry) =>
      record(entry) &&
      keys(entry, ["ref", "handle"]) &&
      record(entry.ref) &&
      Object.keys(entry.ref).length === 0 &&
      typeof entry.handle === "string" &&
      /^h[1-9][0-9]{0,15}$/.test(entry.handle),
  );
}

/** The real host checks even messages posted directly, outside the friendly Worker proxy. */
export function parsePluginWorkerMessage(
  value: unknown,
  account?: (usage: { bytes: number; entries: number }) => void,
): WorkerMessage {
  assertPluginWireBudget(value, PLUGIN_WIRE_LIMITS, account);
  let valid = false;
  if (record(value))
    switch (value.t) {
      case "hello":
        valid = keys(value, ["t", "protocolVersion"]) && value.protocolVersion === PLUGIN_PROTOCOL_VERSION;
        break;
      case "ready":
        valid =
          keys(value, ["t", "protocolVersion", "hasMigration"]) &&
          value.protocolVersion === PLUGIN_PROTOCOL_VERSION &&
          typeof value.hasMigration === "boolean";
        break;
      case "failed":
        valid = keys(value, ["t", "error"]) && string(value.error, 4096);
        break;
      case "dispose":
        valid = keys(value, ["t", "handle"]) && string(value.handle, 128) && value.handle.length > 0;
        break;
      case "cancel":
      case "healthy":
        valid = keys(value, ["t", "id"]) && validPluginCallId(value.id);
        break;
      case "call":
        valid =
          keys(value, ["t", "id", "method", "args", "reaction"]) &&
          validPluginCallId(value.id) &&
          string(value.method, 256) &&
          value.method.length > 0 &&
          wire(value.args) &&
          Array.isArray(value.args.data) &&
          (value.reaction === undefined ||
            (record(value.reaction) &&
              keys(value.reaction, ["id", "status"]) &&
              string(value.reaction.id, 64) &&
              value.reaction.id.length > 0 &&
              (value.reaction.status === "ready" || value.reaction.status === "cycle")));
        break;
      case "result":
        valid =
          validPluginCallId(value.id) &&
          (value.ok === true
            ? keys(value, ["t", "id", "ok", "value"]) && wire(value.value)
            : value.ok === false && keys(value, ["t", "id", "ok", "error", "code", "stack"]) && failure(value));
        break;
      case "migrated":
        valid =
          validPluginCallId(value.id) &&
          (value.ok === true
            ? keys(value, ["t", "id", "ok"])
            : value.ok === false &&
              keys(value, ["t", "id", "ok", "error", "stack"]) &&
              string(value.error, 4096) &&
              stack(value));
        break;
      case "quiesced":
        valid = keys(value, ["t", "error"]) && (value.error === undefined || string(value.error, 4096));
        break;
      case "deactivated":
        valid = keys(value, ["t"]);
        break;
    }
  if (!valid) throw new AppError("plugin/invalid-input", "Invalid plugin Worker message");
  return value as WorkerMessage;
}
