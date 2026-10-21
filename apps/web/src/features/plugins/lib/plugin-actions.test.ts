import { describe, expect, test } from "bun:test";
import type { PluginAction } from "./plugin-types";
import { splitToolbarActions } from "./plugin-actions";

const action = (id: string, extra: Partial<PluginAction> = {}): PluginAction => ({
  id,
  label: id,
  run: () => undefined,
  ...extra,
});

const ids = (actions: PluginAction[]) => actions.map((item) => item.id);

describe("splitToolbarActions", () => {
  test("keeps a short unprioritized set entirely inline", () => {
    const split = splitToolbarActions([action("a"), action("b"), action("c")]);
    expect(ids(split.inline)).toEqual(["a", "b", "c"]);
    expect(split.overflow).toEqual([]);
  });

  test("folds a long unprioritized set after the inline limit, preserving order", () => {
    const split = splitToolbarActions(["a", "b", "c", "d", "e"].map((id) => action(id)));
    expect(ids(split.inline)).toEqual(["a", "b"]);
    expect(ids(split.overflow)).toEqual(["c", "d", "e"]);
  });

  test("explicit primary stays inline wherever it is declared; secondary always overflows", () => {
    const split = splitToolbarActions([
      action("refresh", { priority: "secondary" }),
      action("export"),
      action("new", { priority: "primary" }),
      action("filter"),
    ]);
    expect(ids(split.inline)).toEqual(["export", "new"]);
    expect(ids(split.overflow)).toEqual(["refresh", "filter"]);
  });

  test("a solid action counts as primary unless the plugin says otherwise", () => {
    const split = splitToolbarActions([action("a"), action("b"), action("c"), action("apply", { variant: "solid" })]);
    expect(ids(split.inline)).toEqual(["a", "apply"]);
    expect(ids(split.overflow)).toEqual(["b", "c"]);

    const demoted = splitToolbarActions([
      action("a"),
      action("b"),
      action("c"),
      action("apply", { variant: "solid", priority: "secondary" }),
    ]);
    expect(ids(demoted.inline)).toEqual(["a", "b"]);
    expect(ids(demoted.overflow)).toEqual(["c", "apply"]);
  });

  test("any explicit priority disables the keep-all-inline shortcut, though a lone overflow still moves inline", () => {
    const split = splitToolbarActions([action("a", { priority: "secondary" }), action("b")]);
    expect(ids(split.inline)).toEqual(["a", "b"]);
    expect(split.overflow).toEqual([]);
  });

  test("more primaries than slots all stay inline and leave nothing for the rest", () => {
    const split = splitToolbarActions([
      action("x", { priority: "primary" }),
      action("y", { priority: "primary" }),
      action("z", { priority: "primary" }),
      action("w"),
      action("v"),
    ]);
    expect(ids(split.inline)).toEqual(["x", "y", "z"]);
    expect(ids(split.overflow)).toEqual(["w", "v"]);
  });

  test("a lone overflow action moves back inline at its declaration position", () => {
    const split = splitToolbarActions([
      action("x", { priority: "primary" }),
      action("s", { priority: "secondary" }),
      action("y", { priority: "primary" }),
    ]);
    expect(ids(split.inline)).toEqual(["x", "s", "y"]);
    expect(split.overflow).toEqual([]);

    const unprioritized = splitToolbarActions([
      action("x", { priority: "primary" }),
      action("y", { priority: "primary" }),
      action("w"),
    ]);
    expect(ids(unprioritized.inline)).toEqual(["x", "y", "w"]);
    expect(unprioritized.overflow).toEqual([]);
  });

  test("two secondaries still overflow together", () => {
    const split = splitToolbarActions([
      action("x", { priority: "primary" }),
      action("a", { priority: "secondary" }),
      action("b", { priority: "secondary" }),
    ]);
    expect(ids(split.inline)).toEqual(["x"]);
    expect(ids(split.overflow)).toEqual(["a", "b"]);
  });
});
