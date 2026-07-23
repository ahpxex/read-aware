import { describe, expect, test } from "bun:test";
import {
  navigatePluginViewStack,
  normalizePluginView,
  PluginViewError,
} from "./plugin-view";

const noOp = () => undefined;

describe("normalizePluginView", () => {
  test("accepts a semantic detail with host metadata and actions", () => {
    const view = normalizePluginView({
      kind: "detail",
      content: [{ kind: "text", text: "Primary content", variant: "heading" }],
      metadata: [
        { kind: "label", label: "Book", value: "Frankenstein", icon: "book-open" },
        { kind: "tags", label: "Themes", values: ["chance", "discovery"] },
      ],
      actions: [{ id: "remove", label: "Remove", variant: "ghost", run: noOp }],
    });

    expect(view.kind).toBe("detail");
    if (view.kind !== "detail") throw new Error("unexpected view");
    expect(view.metadata).toHaveLength(2);
    expect(view.actions?.[0].variant).toBe("ghost");
  });

  test("bounds columns while preserving nested host composition", () => {
    const view = normalizePluginView({
      kind: "blocks",
      blocks: [
        {
          kind: "columns",
          cells: [
            { weight: 99, blocks: [{ kind: "metric", label: "Books", value: "12" }] },
            { weight: 0, blocks: [{ kind: "progress", value: 4, max: 10 }] },
          ],
        },
      ],
    });

    if (view.kind !== "blocks" || view.blocks[0].kind !== "columns") {
      throw new Error("unexpected view");
    }
    expect(view.blocks[0].cells[0].weight).toBe(4);
    expect(view.blocks[0].cells[1].weight).toBe(0.25);
  });

  test("rejects columns outside the 2–4 cell contract", () => {
    expect(() =>
      normalizePluginView({
        kind: "blocks",
        blocks: [{ kind: "columns", cells: [{ blocks: [] }] }],
      }),
    ).toThrow(PluginViewError);
  });

  test("rejects recursively nested layouts beyond the host limit", () => {
    let block: unknown = { kind: "text", text: "leaf" };
    for (let index = 0; index < 8; index += 1) {
      block = { kind: "group", blocks: [block] };
    }

    expect(() => normalizePluginView({ kind: "blocks", blocks: [block] })).toThrow(
      /6-level limit/,
    );
  });

  test("validates dictionary snapshots before they reach the canonical renderer", () => {
    expect(() =>
      normalizePluginView({
        kind: "blocks",
        blocks: [{ kind: "dictionary", entry: { headword: "serendipity" } }],
      }),
    ).toThrow(/senses must be an array/);
  });

  test("normalizes searchable lists and their accessories", () => {
    const view = normalizePluginView({
      kind: "list",
      searchable: true,
      timeline: true,
      items: [
        {
          id: "one",
          title: "Serendipity",
          timestamp: "2026-07-24T10:00:00.000Z",
          presentation: "dialog",
          keywords: ["chance"],
          accessories: [{ kind: "tag", text: "Frankenstein" }],
          onSelect: noOp,
        },
      ],
    });

    expect(view.kind).toBe("list");
    if (view.kind !== "list") throw new Error("unexpected view");
    expect(view.searchable).toBe(true);
    expect(view.timeline).toBe(true);
    expect(view.items[0].timestamp).toBe("2026-07-24T10:00:00.000Z");
    expect(view.items[0].presentation).toBe("dialog");
    expect(view.items[0].accessories?.[0]).toEqual({ kind: "tag", text: "Frankenstein" });
  });
});

describe("navigatePluginViewStack", () => {
  const root = normalizePluginView({ kind: "blocks", blocks: [] });
  const detail = normalizePluginView({ kind: "blocks", blocks: [{ kind: "text", text: "A" }] });
  const refreshedRoot = normalizePluginView({ kind: "blocks", blocks: [{ kind: "text", text: "B" }] });

  test("pushes, replaces, and resets host view stacks", () => {
    expect(navigatePluginViewStack([root], detail, "push")).toEqual([root, detail]);
    expect(navigatePluginViewStack([root, detail], refreshedRoot, "replace")).toEqual([
      root,
      refreshedRoot,
    ]);
    expect(navigatePluginViewStack([root, detail], refreshedRoot, "reset")).toEqual([
      refreshedRoot,
    ]);
  });

  test("rejects unknown navigation modes", () => {
    expect(() => navigatePluginViewStack([root], detail, "teleport")).toThrow(
      /unknown plugin navigation mode/,
    );
  });
});
