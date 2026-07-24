import { describe, expect, test } from "bun:test";
import { normalizeShortcutBindings } from "./shortcut-bindings";

describe("shortcut binding migrations", () => {
  test("moves historical sentence action ids to generic mode actions", () => {
    expect(normalizeShortcutBindings({
      "navigator-next-sentence": { key: "j" },
      "navigator-prev-sentence": { key: "k" },
    })).toEqual({
      "reader-mode-next-unit": { key: "j" },
      "reader-mode-prev-unit": { key: "k" },
    });
  });

  test("prefers a current id when both schemas are present", () => {
    expect(normalizeShortcutBindings({
      "reader-mode-next-unit": { key: "n" },
      "navigator-next-sentence": { key: "j" },
    })["reader-mode-next-unit"]).toEqual({ key: "n" });
  });
});
