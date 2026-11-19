import { describe, expect, test } from "bun:test";
import { isResizeObserverLoopNotice } from "./global-error-log";

describe("isResizeObserverLoopNotice", () => {
  test("recognizes both engines' loop notices, which carry no error object", () => {
    expect(isResizeObserverLoopNotice({ error: null, message: "ResizeObserver loop limit exceeded" })).toBe(true);
    expect(
      isResizeObserverLoopNotice({
        error: null,
        message: "ResizeObserver loop completed with undelivered notifications.",
      }),
    ).toBe(true);
  });

  test("keeps real errors, including thrown ones that mention ResizeObserver", () => {
    expect(isResizeObserverLoopNotice({ error: null, message: "Script error." })).toBe(false);
    const thrown = new Error("ResizeObserver loop limit exceeded");
    expect(isResizeObserverLoopNotice({ error: thrown, message: thrown.message })).toBe(false);
    expect(isResizeObserverLoopNotice({ error: null, message: "Uncaught ResizeObserver is not defined" })).toBe(false);
  });
});
