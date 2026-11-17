import { expect, test } from "bun:test";
import { PluginHostBudget, PluginTrafficBudget } from "./plugin-host-budget";
import { PluginCallbackBudget } from "./plugin-callback-budget";
import { assertPluginWireBudget } from "./plugin-wire-budget";

test("global leases reject before allocation, survive owner replacement, and release only owned capacity", () => {
  const budget = new PluginHostBudget({ calls: 2, invokes: 1, registrations: 2, callbacks: 3 });
  const old = budget.reserve("calls"),
    replacement = budget.reserve("calls");
  expect(() => budget.reserve("calls")).toThrow();
  old.release();
  old.release();
  expect(budget.snapshot().calls).toBe(1);
  const other = budget.reserve("calls");
  replacement.release();
  other.release();
  for (const kind of ["invokes", "registrations", "callbacks"] as const) {
    const lease = budget.reserve(kind);
    expect(() => lease.release(-1)).toThrow();
    lease.release(100);
    lease.release();
  }
  expect(budget.snapshot()).toEqual({ calls: 0, invokes: 0, registrations: 0, callbacks: 0 });
  expect(() => budget.reserve("calls", NaN)).toThrow();
});

test("callback owners share the global budget and shutdown releases only their surviving graph handles", () => {
  const budget = new PluginHostBudget({ calls: 1, invokes: 1, registrations: 1, callbacks: 3 });
  const first = new PluginCallbackBudget((count) => budget.reserve("callbacks", count));
  const second = new PluginCallbackBudget((count) => budget.reserve("callbacks", count));
  const wire = {
    data: null,
    callbacks: [
      { ref: {}, handle: "h1" },
      { ref: {}, handle: "h2" },
    ],
  };
  const lease = first.acquire(wire);
  expect(() => second.acquire(wire)).toThrow();
  expect(second.size).toBe(0);
  lease.release(["h1", "h1"]);
  const other = second.acquire(wire);
  first.close();
  lease.dispose();
  expect(budget.snapshot().callbacks).toBe(2);
  second.close();
  other.dispose();
  expect(budget.snapshot().callbacks).toBe(0);
});

const rates = (messages: number, bytes = 100, entries = 10) => ({
  burst: { messages, bytes, entries },
  perSecond: { messages: 1, bytes: 10, entries: 1 },
});
test("traffic is metered per plugin, survives a restart, and one plugin cannot spend another's", () => {
  let now = 0;
  const budget = new PluginTrafficBudget(rates(2), () => now);
  const busy = budget.open("busy");
  busy.message();
  busy.message();
  expect(() => busy.message()).toThrow();
  // Restarting the plugin's Worker does not refill its bucket.
  expect(() => budget.open("busy").message()).toThrow();
  // Another plugin keeps its whole budget.
  const quiet = budget.open("quiet");
  quiet.message();
  quiet.message();
  now = 1000;
  budget.open("busy").message();
  expect(() => budget.open("busy").message()).toThrow();
});

test("bytes and traversal entries are independently metered across both directions and refill is burst bounded", () => {
  let now = 0;
  const budget = new PluginTrafficBudget(rates(100, 150, 15), () => now);
  const first = budget.open("plugin"),
    second = budget.open("plugin");
  first.graph({ bytes: 100, entries: 5 });
  second.graph({ bytes: 50, entries: 10 });
  expect(() => budget.open("plugin").graph({ bytes: 1, entries: 0 })).toThrow();
  expect(() => budget.open("plugin").graph({ bytes: 0, entries: 1 })).toThrow();
  now = 1e9;
  expect(() => first.graph({ bytes: 151, entries: 0 })).toThrow();
  first.graph({ bytes: 150, entries: 15 });
});

test("rejected oversized graphs report consumed traversal and bytes rather than escaping the traffic meter", () => {
  const usage: { bytes: number; entries: number }[] = [];
  expect(() =>
    assertPluginWireBudget("oversized", { bytes: 8, entries: 10, depth: 10 }, (value) => usage.push(value)),
  ).toThrow();
  expect(usage).toEqual([{ bytes: 26, entries: 1 }]);
  assertPluginWireBudget({ data: "ok" }, undefined, (value) => usage.push(value));
  expect(usage[1]).toEqual({ bytes: 28, entries: 2 });
});
