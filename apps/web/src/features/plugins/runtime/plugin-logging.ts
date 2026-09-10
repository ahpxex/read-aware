import { AppError, ERR_PLUGIN_INVALID_ARGUMENT, ERR_PLUGIN_QUOTA_EXCEEDED } from "@read-aware/core";
import type { PluginLogEntry, PluginLoggingService, PluginLogReceipt, PluginLifecyclePhase } from "@read-aware/plugin-types";
import { createLogger, type Logger } from "../../../platform/logger";
import type { PluginLifecycleController } from "./plugin-lifecycle";

const WINDOW_MS = 60_000;
const PLUGIN_LIMIT = 60;
const APP_LIMIT = 300;
const MAX_FIELDS = 12;
const MAX_ENTRY_CHARS = 1500;
const EVENT_NAME = /^[a-z][a-z0-9_.\/-]{0,95}$/;
const FIELD_NAME = /^[a-z][a-zA-Z0-9_]{0,31}$/;

/** One shared rolling window. At most APP_LIMIT entries remain in memory;
 * retiring/reloading a plugin does not replenish its allowance. No timers. */
export class PluginLogBudget {
  private entries: Array<{ pluginId: string; at: number }> = [];
  constructor(private readonly now = () => performance.now()) {}

  take(pluginId: string): number | null {
    const now = this.now();
    this.entries = this.entries.filter(entry => entry.at > now - WINDOW_MS);
    const owned = this.entries.filter(entry => entry.pluginId === pluginId);
    let retryAt = now;
    if (owned.length >= PLUGIN_LIMIT) retryAt = Math.max(retryAt, owned[0].at + WINDOW_MS);
    if (this.entries.length >= APP_LIMIT) retryAt = Math.max(retryAt, this.entries[0].at + WINDOW_MS);
    if (retryAt > now) return Math.ceil(retryAt - now);
    this.entries.push({ pluginId, at: now });
    return null;
  }
}

type LogEnvelope = Omit<PluginLogEntry, "level"> & { version: string; phase: PluginLifecyclePhase };

function normalize(entry: PluginLogEntry, version: string, phase: PluginLifecyclePhase): { level: PluginLogEntry["level"]; payload: LogEnvelope } {
  const invalid = (): never => { throw new AppError(ERR_PLUGIN_INVALID_ARGUMENT, "Expected a structured plugin diagnostic event"); };
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return invalid();
  if (Object.keys(entry).some(key => !["level", "event", "errorCode", "fields"].includes(key))) return invalid();
  if (!["debug", "info", "warn", "error"].includes(entry.level) || typeof entry.event !== "string" || !EVENT_NAME.test(entry.event)) return invalid();
  if (entry.errorCode !== undefined && (typeof entry.errorCode !== "string" || !EVENT_NAME.test(entry.errorCode))) return invalid();
  const payload: LogEnvelope = { event: entry.event, version, phase };
  if (entry.errorCode !== undefined) payload.errorCode = entry.errorCode;
  if (entry.fields !== undefined) {
    if (!entry.fields || typeof entry.fields !== "object" || Array.isArray(entry.fields)) return invalid();
    const fields = Object.entries(entry.fields);
    if (fields.length > MAX_FIELDS) throw new AppError(ERR_PLUGIN_QUOTA_EXCEEDED, "Too many plugin diagnostic measurements");
    payload.fields = {};
    for (const [key, value] of fields) {
      if (!FIELD_NAME.test(key) || (typeof value !== "boolean" && (typeof value !== "number" || !Number.isFinite(value)))) return invalid();
      Object.defineProperty(payload.fields, key, { enumerable: true, value });
    }
  }
  if (JSON.stringify(payload).length > MAX_ENTRY_CHARS) throw new AppError(ERR_PLUGIN_QUOTA_EXCEEDED, "Plugin diagnostic entry exceeds character budget");
  return { level: entry.level, payload };
}

const sharedBudget = new PluginLogBudget();

export function createPluginLogging(
  pluginId: string,
  version: string,
  lifecycle: PluginLifecycleController,
  options: { budget?: PluginLogBudget; logger?: Logger; development?: boolean } = {},
): PluginLoggingService {
  const budget = options.budget ?? sharedBudget;
  const logger = options.logger ?? createLogger(`plugin:${pluginId}`);
  const development = options.development ?? import.meta.env.DEV;
  return {
    async policy() {
      lifecycle.signal.throwIfAborted();
      return { levels: development ? ["debug", "info", "warn", "error"] : ["info", "warn", "error"],
        maxEntryChars: MAX_ENTRY_CHARS, maxFields: MAX_FIELDS, perPluginLimit: PLUGIN_LIMIT,
        appLimit: APP_LIMIT, windowMs: WINDOW_MS, delivery: "best-effort" };
    },
    async write(entry): Promise<PluginLogReceipt> {
      lifecycle.signal.throwIfAborted();
      const { level, payload } = normalize(entry, version, lifecycle.phase);
      if (level === "debug" && !development) return { status: "disabled" };
      const retryAfterMs = budget.take(pluginId);
      if (retryAfterMs !== null) return { status: "rate-limited", retryAfterMs };
      logger[level]("plugin-event", payload);
      return { status: "accepted" };
    },
  };
}
