import { expect, test } from "bun:test";
import { stepTextUnit, type TextUnitStepAdapter } from "./text-unit-stepper";

function fixture(counts = [2, 0, 2], page = false) {
  let section = 0;
  let current = 0;
  let rests = true;
  const navigated: (number | string)[] = [];
  const position = (unit: number) => ({
    modeKey: "test:mode",
    unitId: "paragraph",
    location: { bookId: "book", contentVersion: "v1", cfi: `${section}:${unit}` },
  });
  const adapter: TextUnitStepAdapter = {
    resting: () => (rests && counts[section] ? position(current) : null),
    index: async () => ({
      sectionIndex: section,
      count: counts[section]!,
      currentIndex: current,
      visibleIndex: counts[section] ? 0 : -1,
      page,
      position,
    }),
    adjacent: (index, direction) =>
      index + direction < 0 || index + direction >= counts.length ? null : index + direction,
    navigate: async (target) => {
      navigated.push(typeof target === "number" ? target : target.location.cfi);
      if (typeof target === "number") {
        section = target;
        current = -1;
      } else {
        [section, current] = target.location.cfi.split(":").map(Number) as [number, number];
        rests = true;
      }
    },
    land: async () => {},
    vacate: () => {
      rests = false;
    },
  };
  return { adapter, navigated, location: () => [section, current] };
}

test("steps exact units, skips empty sections in either direction and reports terminal boundaries", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  expect(await stepTextUnit(f.adapter, -1, signal)).toBe("start-of-book");
  expect(await stepTextUnit(f.adapter, 1, signal)).toBe("moved");
  expect(f.location()).toEqual([0, 1]);
  expect(await stepTextUnit(f.adapter, 1, signal)).toBe("moved");
  expect(f.location()).toEqual([2, 0]);
  expect(await stepTextUnit(f.adapter, -1, signal)).toBe("moved");
  expect(f.location()).toEqual([0, 1]);
  await stepTextUnit(f.adapter, 1, signal);
  await stepTextUnit(f.adapter, 1, signal);
  expect(await stepTextUnit(f.adapter, 1, signal)).toBe("end-of-book");
  expect(f.location()).toEqual([2, 1]);
});

test("an entirely unitless book terminates and cannot be mistaken for a segmentation failure", async () => {
  const f = fixture([0, 0]);
  expect(await stepTextUnit(f.adapter, 1, new AbortController().signal)).toBe("end-of-book");
  f.adapter.index = async () => {
    throw new Error("provider failed");
  };
  await expect(stepTextUnit(f.adapter, 1, new AbortController().signal)).rejects.toThrow("provider failed");
});

test("cancelled or misdirected traversal never lands a new unit", async () => {
  const f = fixture();
  const abort = new AbortController();
  let landed = false;
  f.adapter.land = async () => {
    landed = true;
  };
  f.adapter.navigate = async () => {
    abort.abort(new Error("cancelled"));
  };
  await expect(stepTextUnit(f.adapter, 1, abort.signal)).rejects.toThrow("cancelled");
  expect(landed).toBe(false);
  const empty = fixture([0, 1]);
  empty.adapter.navigate = async () => {};
  await expect(stepTextUnit(empty.adapter, 1, new AbortController().signal)).rejects.toMatchObject({
    code: "reader/target-not-found",
  });
});

test("a step that turns to a page without units stops there, and the next one reads on", async () => {
  // Pages shown whole: text, a figure, a blank leaf, text.
  const f = fixture([2, 0, 0, 1], true);
  const signal = new AbortController().signal;
  await stepTextUnit(f.adapter, 1, signal);
  expect(f.location()).toEqual([0, 1]);
  // Off the last unit: onto the figure, resting on nothing — not through it.
  expect(await stepTextUnit(f.adapter, 1, signal)).toBe("moved");
  expect(f.location()).toEqual([1, -1]);
  expect(f.adapter.resting()).toBeNull();
  expect(await stepTextUnit(f.adapter, 1, signal)).toBe("moved");
  expect(f.location()).toEqual([2, -1]);
  // The next page has text: the step lands on its first unit.
  expect(await stepTextUnit(f.adapter, 1, signal)).toBe("moved");
  expect(f.location()).toEqual([3, 0]);
  // And back the same way, a page at a time, onto the last unit of the first.
  expect(await stepTextUnit(f.adapter, -1, signal)).toBe("moved");
  expect(f.location()).toEqual([2, -1]);
  await stepTextUnit(f.adapter, -1, signal);
  expect(await stepTextUnit(f.adapter, -1, signal)).toBe("moved");
  expect(f.location()).toEqual([0, 1]);
  // A book of nothing but such pages ends where the pages do.
  const scan = fixture([0, 0, 0], true);
  expect(await stepTextUnit(scan.adapter, 1, signal)).toBe("moved");
  expect(await stepTextUnit(scan.adapter, 1, signal)).toBe("moved");
  expect(scan.location()).toEqual([2, -1]);
  expect(await stepTextUnit(scan.adapter, 1, signal)).toBe("end-of-book");
});
