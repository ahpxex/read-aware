import { expect, test } from "bun:test";
import { groupThreadsByDate } from "./thread-groups";

/** A local time, so the boundaries are the user's midnight wherever the test runs. */
const at = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();
const thread = (id: string, time: number | string) => ({
  id,
  updatedAt: typeof time === "number" ? new Date(time).toISOString() : time,
});
const keys = (groups: ReturnType<typeof groupThreadsByDate<{ id: string; updatedAt: string }>>) =>
  groups.map((group) => [group.key, group.items.map((item) => item.id)]);

test("groups by the local calendar, newest first, with a month per group beyond 30 days", () => {
  const now = at(2026, 11, 16, 9);
  const groups = groupThreadsByDate(
    [
      thread("sep", at(2026, 9, 3)),
      thread("today-early", at(2026, 11, 16, 0, 5)),
      thread("yesterday", at(2026, 11, 15, 23, 50)),
      thread("week", at(2026, 11, 9)),
      thread("month", at(2026, 10, 17)),
      thread("oct", at(2026, 10, 16)),
      thread("today-late", at(2026, 11, 16, 8)),
    ],
    now,
  );
  expect(keys(groups)).toEqual([
    ["today", ["today-late", "today-early"]],
    ["yesterday", ["yesterday"]],
    ["previous7", ["week"]],
    ["previous30", ["month"]],
    ["month:2026-10", ["oct"]],
    ["month:2026-09", ["sep"]],
  ]);
});

test("midnight is the boundary on both sides: a minute before is yesterday, a minute after is today", () => {
  const now = at(2026, 11, 16, 0, 1);
  expect(keys(groupThreadsByDate([thread("before", at(2026, 11, 15, 23, 59))], now))).toEqual([
    ["yesterday", ["before"]],
  ]);
  expect(keys(groupThreadsByDate([thread("after", at(2026, 11, 16, 0, 0))], now))).toEqual([["today", ["after"]]]);
});

test("the 7- and 30-day stretches end where they say", () => {
  const now = at(2026, 11, 16);
  expect(
    keys(
      groupThreadsByDate(
        [
          thread("d7", at(2026, 11, 9)),
          thread("d8", at(2026, 11, 8)),
          thread("d30", at(2026, 10, 17)),
          thread("d31", at(2026, 10, 16)),
        ],
        now,
      ),
    ),
  ).toEqual([
    ["previous7", ["d7"]],
    ["previous30", ["d8", "d30"]],
    ["month:2026-10", ["d31"]],
  ]);
});

test("an unreadable time trails in its own group; a future one (a skewed clock) counts as today", () => {
  const now = at(2026, 11, 16);
  expect(
    keys(groupThreadsByDate([thread("blank", ""), thread("future", at(2026, 11, 18)), thread("now", now)], now)),
  ).toEqual([
    ["today", ["future", "now"]],
    ["older", ["blank"]],
  ]);
  expect(groupThreadsByDate([], now)).toEqual([]);
});
