import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildScheduleTools } from "./schedule-tools";

test("global schedule changes require approval and cannot invent an unbound schedule", async () => {
  const { deps, stores } = createInMemoryDeps(); let calls = 0;
  const schedule = { pluginId: "plugin", id: "refresh", label: "Refresh", everyMinutes: 60, paused: false, running: false,
    lastStartedAt: null, lastFinishedAt: null, lastSuccessAt: null, lastOutcome: null, lastErrorCode: null };
  deps.schedules.list = async () => ({ schedules: [schedule], total: 1, nextOffset: null });
  deps.schedules.control = async () => { calls++; return { status: "completed", schedule }; };
  expect(buildScheduleTools({ kind: "book", bookId: "b1" }, deps)).toEqual([]);
  const [, tool] = buildScheduleTools({ kind: "global", threadId: "thread-1" }, deps);
  const input = { pluginId: "plugin", id: "refresh", action: "pause" };
  await tool.execute("pause", input); expect(calls).toBe(1); expect(stores.interactions[0]).toMatchObject({ action: "manage-schedule" });
  deps.interactions.request = async () => ({ optionId: "decline" });
  await tool.execute("decline", input); expect(calls).toBe(1);
  await expect(tool.execute("missing", { ...input, id: "missing" })).rejects.toMatchObject({ code: "ui/unavailable" });
});
