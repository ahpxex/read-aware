import { describe, expect, test } from "bun:test";
import { normalizeShortcutBindings } from "./shortcut-bindings";

describe("shortcut binding migrations", () => {
  test("unknown builtin records cannot leave an invisible unresettable override", () => {
    expect(
      normalizeShortcutBindings({
        removed: { key: "x" },
        "plugin:": { key: "y" },
        "plugin:retired:open": { mod: true, key: "p" },
      }),
    ).toEqual({ "plugin:retired:open": { mod: true, key: "p" } });
  });
  test("moves historical sentence action ids to generic mode actions", () => {
    expect(
      normalizeShortcutBindings({
        "navigator-next-sentence": { key: "j" },
        "navigator-prev-sentence": { key: "k" },
      }),
    ).toEqual({
      "reader-mode-next-unit": { key: "j" },
      "reader-mode-prev-unit": { key: "k" },
    });
  });

  test("prefers a current id when both schemas are present", () => {
    expect(
      normalizeShortcutBindings({
        "reader-mode-next-unit": { key: "n" },
        "navigator-next-sentence": { key: "j" },
      })["reader-mode-next-unit"],
    ).toEqual({ key: "n" });
  });

  test("carries Jumper's rebound history keys over to the reader's history actions", () => {
    expect(
      normalizeShortcutBindings({
        "plugin:jumper:back": { mod: true, key: "[" },
        "plugin:jumper:forward": { mod: true, key: "]" },
        "plugin:jumper:open": { mod: true, key: "j" },
      }),
    ).toEqual({
      "history-back": { mod: true, key: "[" },
      "history-forward": { mod: true, key: "]" },
      "plugin:jumper:open": { mod: true, key: "j" },
    });
    expect(
      normalizeShortcutBindings({
        "history-back": { key: "b" },
        "plugin:jumper:back": { mod: true, key: "[" },
      })["history-back"],
    ).toEqual({ key: "b" });
  });
});
