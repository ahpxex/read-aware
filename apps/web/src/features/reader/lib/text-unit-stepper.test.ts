import { expect, test } from "bun:test";
import { stepTextUnit, type TextUnitStepAdapter } from "./text-unit-stepper";

function fixture(counts = [2, 0, 2]) {
  let section = 0; let current = 0;
  const navigated: (number | string)[] = [];
  const position = (unit: number) => ({ modeKey: "test:mode", unitId: "paragraph", location: { bookId: "book", contentVersion: "v1", cfi: `${section}:${unit}` } });
  const adapter: TextUnitStepAdapter = {
    resting: () => counts[section] ? position(current) : null,
    index: async () => ({ sectionIndex: section, count: counts[section]!, currentIndex: current, visibleIndex: 0, position }),
    adjacent: (index, direction) => index + direction < 0 || index + direction >= counts.length ? null : index + direction,
    navigate: async target => {
      navigated.push(typeof target === "number" ? target : target.location.cfi);
      if (typeof target === "number") { section = target; current = -1; }
      else [section, current] = target.location.cfi.split(":").map(Number) as [number, number];
    },
    land: async () => {},
  };
  return { adapter, navigated, location: () => [section, current] };
}

test("steps exact units, skips empty sections in either direction and reports terminal boundaries", async () => {
  const f = fixture(); const signal = new AbortController().signal;
  expect(await stepTextUnit(f.adapter, -1, signal)).toBe("start-of-book");
  expect(await stepTextUnit(f.adapter, 1, signal)).toBe("moved"); expect(f.location()).toEqual([0, 1]);
  expect(await stepTextUnit(f.adapter, 1, signal)).toBe("moved"); expect(f.location()).toEqual([2, 0]);
  expect(await stepTextUnit(f.adapter, -1, signal)).toBe("moved"); expect(f.location()).toEqual([0, 1]);
  await stepTextUnit(f.adapter, 1, signal); await stepTextUnit(f.adapter, 1, signal);
  expect(await stepTextUnit(f.adapter, 1, signal)).toBe("end-of-book");
  expect(f.location()).toEqual([2, 1]);
});

test("an entirely unitless book terminates and cannot be mistaken for a segmentation failure", async () => {
  const f = fixture([0, 0]);
  expect(await stepTextUnit(f.adapter, 1, new AbortController().signal)).toBe("end-of-book");
  f.adapter.index = async () => { throw new Error("provider failed"); };
  await expect(stepTextUnit(f.adapter, 1, new AbortController().signal)).rejects.toThrow("provider failed");
});

test("cancelled or misdirected traversal never lands a new unit", async () => {
  const f = fixture(); const abort = new AbortController();
  let landed = false; f.adapter.land = async () => { landed = true; };
  f.adapter.navigate = async () => { abort.abort(new Error("cancelled")); };
  await expect(stepTextUnit(f.adapter, 1, abort.signal)).rejects.toThrow("cancelled");
  expect(landed).toBe(false);
  const empty = fixture([0, 1]); empty.adapter.navigate = async () => {};
  await expect(stepTextUnit(empty.adapter, 1, new AbortController().signal)).rejects.toMatchObject({ code: "reader/target-not-found" });
});
