import { AppError } from "@read-aware/core";
import type { PluginScheduleDeclaration } from "@read-aware/plugin-types";
import { localKV } from "../../../platform/local-store";
import { isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import { PluginScheduleController, type ScheduleRecord } from "./plugin-schedule-controller";
export { isScheduleDue } from "./plugin-schedule-controller";

const log = createLogger("plugin-schedules");
const stateKey = (id: string) => `read-aware-plugin.${id}.schedule-state`;
function read(pluginId: string): Record<string, ScheduleRecord> {
  if (!isTauri() && typeof localStorage === "undefined") return {};
  const raw = localKV.getItem(stateKey(pluginId));
  if (raw) {
    let records: unknown;
    try { records = JSON.parse(raw); } catch (error) { throw new AppError("db/error", "Invalid schedule JSON", { cause: error }); }
    if (!records || typeof records !== "object" || Array.isArray(records)) throw new AppError("db/error", "Invalid stored schedule state");
    for (const record of Object.values(records)) {
      if (!record || typeof record !== "object" || typeof record.paused !== "boolean"
        || ![null, "running", "succeeded", "failed", "cancelled", "interrupted"].includes(record.lastOutcome)
        || ![record.lastStartedAt, record.lastFinishedAt, record.lastSuccessAt].every(value => value === null || (Number.isFinite(value) && value >= 0 && value <= 8.64e15))
        || (record.lastErrorCode !== null && typeof record.lastErrorCode !== "string")) throw new AppError("db/error", "Invalid stored schedule record");
    }
    return Object.fromEntries(Object.entries(records as Record<string, ScheduleRecord>).map(([id, record]) => [id, {
      paused: record.paused, lastStartedAt: record.lastStartedAt, lastFinishedAt: record.lastFinishedAt,
      lastSuccessAt: record.lastSuccessAt, lastOutcome: record.lastOutcome, lastErrorCode: record.lastErrorCode,
    }]));
  }
  // Legacy stamps describe attempts, never successful outcomes.
  const legacy = localKV.getItem(`read-aware-plugin.${pluginId}.schedule-runs`);
  if (!legacy) return {};
  try {
    const entries: unknown = JSON.parse(legacy);
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) return {};
    return Object.fromEntries(Object.entries(entries).map(([id, stamp]) => [id, { paused: false,
      lastStartedAt: typeof stamp === "string" && Number.isFinite(Date.parse(stamp)) ? Date.parse(stamp) : null,
      lastFinishedAt: null, lastSuccessAt: null, lastOutcome: null, lastErrorCode: null }]));
  } catch (error) { log.warn("Ignoring malformed legacy schedule stamps", error); return {}; }
}
export const pluginSchedules = new PluginScheduleController({ read,
  write: (pluginId, records) => localKV.setItemAsync(stateKey(pluginId), JSON.stringify(records)),
}, error => log.warn("Plugin schedule failed", error));
export const inspectPluginSchedules = () => pluginSchedules.inspect();

let first: ReturnType<typeof setTimeout> | undefined;
let loop: ReturnType<typeof setInterval> | undefined;
function updateLoop() {
  if (!pluginSchedules.size) {
    clearTimeout(first); clearInterval(loop); first = undefined; loop = undefined;
  } else if (first === undefined && loop === undefined) {
    first = setTimeout(() => {
      first = undefined; pluginSchedules.sweep();
      if (pluginSchedules.size) loop = setInterval(() => pluginSchedules.sweep(), 60_000);
    }, 5_000);
  }
}
export function registerPluginSchedule(pluginId: string, declaration: PluginScheduleDeclaration, run: () => void | Promise<void>) {
  const registration = pluginSchedules.register(pluginId, declaration, run); updateLoop();
  return { dispose: () => { registration.dispose(); updateLoop(); } };
}
