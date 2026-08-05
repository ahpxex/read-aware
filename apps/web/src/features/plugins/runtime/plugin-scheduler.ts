/**
 * Host-owned scheduler for manifest-declared plugin schedules.
 *
 * Semantics are deliberately loose: a bound schedule runs AT LEAST every
 * `everyMinutes` while the app is open, with a catch-up sweep shortly after
 * launch when a cadence was missed. Exact times are never promised, nothing
 * runs while the app is closed, and plugins never install OS-level jobs —
 * all timing lives in this one loop.
 *
 * Last-run instants persist per plugin+schedule (device-local presentation
 * state, not a domain fact) so relaunches don't rerun fresh work. The stamp
 * is written at TRIGGER time: a failing run waits out a full cadence instead
 * of hot-looping.
 */
import {
  MIN_SCHEDULE_MINUTES,
  type PluginDisposable,
  type PluginScheduleDeclaration,
} from "@read-aware/plugin-types";
import { localKV } from "../../../platform/local-store";

/** First sweep waits for boot to settle; later sweeps tick once a minute. */
const FIRST_SWEEP_DELAY_MS = 5_000;
const SWEEP_INTERVAL_MS = 60_000;

type ScheduledTask = {
  pluginId: string;
  scheduleId: string;
  everyMinutes: number;
  run: () => void | Promise<void>;
  running: boolean;
};

const tasks = new Map<string, ScheduledTask>();
let loopStarted = false;

function runsKey(pluginId: string): string {
  return `read-aware-plugin.${pluginId}.schedule-runs`;
}

function readLastRuns(pluginId: string): Record<string, string> {
  try {
    const raw = localKV.getItem(runsKey(pluginId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function stampLastRun(pluginId: string, scheduleId: string, at: number): void {
  const runs = readLastRuns(pluginId);
  runs[scheduleId] = new Date(at).toISOString();
  localKV.setItem(runsKey(pluginId), JSON.stringify(runs));
}

/** Pure due-check, exported for tests. */
export function isScheduleDue(
  lastRunIso: string | undefined,
  everyMinutes: number,
  nowMs: number,
): boolean {
  const cadence = Math.max(everyMinutes, MIN_SCHEDULE_MINUTES) * 60_000;
  if (!lastRunIso) return true;
  const last = Date.parse(lastRunIso);
  // A garbled or FUTURE stamp (clock moved back) must not wedge the task.
  if (!Number.isFinite(last) || last > nowMs) return true;
  return nowMs - last >= cadence;
}

function sweep(): void {
  const now = Date.now();
  for (const task of tasks.values()) {
    if (task.running) continue;
    const last = readLastRuns(task.pluginId)[task.scheduleId];
    if (!isScheduleDue(last, task.everyMinutes, now)) continue;
    task.running = true;
    stampLastRun(task.pluginId, task.scheduleId, now);
    Promise.resolve()
      .then(() => task.run())
      .catch((error) => {
        console.warn(
          `[plugins] schedule "${task.pluginId}:${task.scheduleId}" failed`,
          error,
        );
      })
      .finally(() => {
        task.running = false;
      });
  }
}

function ensureLoop(): void {
  if (loopStarted) return;
  loopStarted = true;
  setTimeout(() => {
    sweep();
    setInterval(sweep, SWEEP_INTERVAL_MS);
  }, FIRST_SWEEP_DELAY_MS);
}

export function registerPluginSchedule(
  pluginId: string,
  declaration: PluginScheduleDeclaration,
  run: () => void | Promise<void>,
): PluginDisposable {
  const key = `${pluginId}:${declaration.id}`;
  tasks.set(key, {
    pluginId,
    scheduleId: declaration.id,
    everyMinutes: Math.max(declaration.everyMinutes, MIN_SCHEDULE_MINUTES),
    run,
    running: false,
  });
  ensureLoop();
  return { dispose: () => void tasks.delete(key) };
}
