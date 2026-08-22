import { describe, expect, test } from "bun:test";
import { isDevProductName } from "./app-identity";

describe("isDevProductName", () => {
  test("accepts the dev config's productName family", () => {
    expect(isDevProductName("ReadAware Dev")).toBe(true);
    // Historical parallel-dev identifier (com.readaware.app.dev2) used the
    // same productName family — a marker test must not strand those builds.
    expect(isDevProductName("ReadAware Dev2")).toBe(true);
  });

  test("rejects the production name and anything else", () => {
    expect(isDevProductName("ReadAware")).toBe(false);
    expect(isDevProductName("")).toBe(false);
    expect(isDevProductName("readaware dev")).toBe(false);
  });
});
