import { describe, expect, test } from "bun:test";
import { defaultBinding } from "./shortcuts";

describe("built-in shortcut defaults", () => {
  test("creates a conversation with the platform modifier and N", () => {
    expect(defaultBinding("new-conversation")).toEqual({ mod: true, key: "n" });
  });
});
