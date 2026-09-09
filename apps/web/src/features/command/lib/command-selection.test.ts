import { expect, test } from "bun:test";
import { availableCommandIndex, nextCommandIndex } from "./command-selection";

test("command navigation skips disabled entries, wraps, and handles no available results", () => {
  const items = [{ disabled: true }, {}, { disabled: true }, {}];
  expect(nextCommandIndex(items, 1, 1)).toBe(3);
  expect(nextCommandIndex(items, 3, 1)).toBe(1);
  expect(nextCommandIndex(items, 1, -1)).toBe(3);
  expect(nextCommandIndex(items, -1, -1)).toBe(3);
  expect(availableCommandIndex(items, 1)).toBe(1);
  expect(availableCommandIndex(items, 2)).toBe(3);
  expect(availableCommandIndex(items, 99)).toBe(1);
  expect(availableCommandIndex([], 0)).toBe(-1);
  expect(nextCommandIndex([{ disabled: true }], 0, 1)).toBe(-1);
  expect(availableCommandIndex([{}], -1)).toBe(0);
});
