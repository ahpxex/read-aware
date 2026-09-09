import { expect, test } from "bun:test";
import { normalizeMemoryObservation } from "./memory-observer";

test("graph task observation admits only book-scoped task queries without caller-granted scope", () => {
  expect(normalizeMemoryObservation({ kind: "graphTasks", bookId: "b" })).toEqual({ kind: "graphTasks", bookId: "b" });
  expect(normalizeMemoryObservation({ kind: "graphTask", bookId: "b", taskId: "t" })).toEqual({ kind: "graphTask", bookId: "b", taskId: "t" });
  for (const query of [{ kind: "graphTasks", bookId: "" }, { kind: "graphTasks", bookId: "b", owner: "other" }, { kind: "graphTask", bookId: "b" }, { kind: "graphTask", bookId: "b", taskId: "t", query: {} }]) {
    expect(() => normalizeMemoryObservation(query as never)).toThrow();
  }
});
