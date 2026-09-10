import { expect, test } from "bun:test";
import { getDefaultStore } from "jotai";
import type { ContextActionInput, PluginContextAction, PluginDisposable, PluginHeaderAction } from "../lib/plugin-types";
import { contextActionItems } from "../lib/context-action-items";
import { contextActionsAtom, headerActionsAtom } from "../state/plugin-store";
import { buildPluginContext } from "./plugin-context";

function fixture() {
  const disposables: PluginDisposable[] = [];
  const { context, lifecycle } = buildPluginContext({ id: "context-test", name: "Context test", version: "1.0.0", schemaVersion: 1, permissions: [], requires: {} }, "1.0.0", disposables);
  lifecycle.promote();
  return { context, close: () => { for (const item of disposables.reverse()) item.dispose(); } };
}

test("context menus select their target and forward only a fresh public metadata snapshot", () => {
  const { context, close } = fixture();
  const calls: ContextActionInput[] = [];
  try {
    for (const surface of ["book", "collection"] as const) context.contributions.contextActions.register({
      id: surface, title: surface, surface, run(input) { calls.push(input); },
    });
    const actions = getDefaultStore().get(contextActionsAtom);
    const book = { id: "b", title: "Book", author: "Author", filePath: "/private/book", notes: "private" };
    const bookItems = contextActionItems(actions, { surface: "book", book });
    expect(bookItems.map(item => item.label)).toEqual(["book"]);
    expect(calls).toEqual([]);
    book.title = "Changed after rendering";
    bookItems[0].onClick();
    expect(calls[0]).toEqual({ surface: "book", book: { id: "b", title: "Book", author: "Author" } });
    if (calls[0].surface === "book") calls[0].book.title = "Changed by callback";
    bookItems[0].onClick();
    expect(calls[1]).toEqual({ surface: "book", book: { id: "b", title: "Book", author: "Author" } });
    const collection = { id: "c", name: "Collection", coverUrls: ["private"], count: 45 };
    contextActionItems(actions, { surface: "collection", collection })[0].onClick();
    expect(calls[2]).toEqual({ surface: "collection", collection: { id: "c", name: "Collection" } });
    expect(context.domains.library).toBeUndefined();
  } finally { close(); }
});

test("context actions share dynamic state and exact registration retirement", async () => {
  const { context, close } = fixture();
  try {
    const action: PluginContextAction = { id: "one", title: "One", surface: "book", run() {} };
    const first = context.contributions.contextActions.register(action);
    const cached = getDefaultStore().get(contextActionsAtom)[0];
    const input: ContextActionInput = { surface: "book", book: { id: "b", title: "B" } };
    await first.updateState({ revision: 1, visible: true, enabled: false, checked: true });
    expect(contextActionItems(getDefaultStore().get(contextActionsAtom), input)[0]).toMatchObject({ disabled: true, checked: true });
    expect(() => cached.run(input)).toThrow(expect.objectContaining({ code: "plugin/action-disabled" }));
    await first.updateState({ revision: 2, visible: false, enabled: true });
    expect(contextActionItems(getDefaultStore().get(contextActionsAtom), input)).toEqual([]);
    const next = context.contributions.contextActions.register(action);
    expect(await first.updateState({ revision: 3, visible: true, enabled: true })).toEqual({ status: "inactive" });
    expect(() => cached.run(input)).toThrow(expect.objectContaining({ code: "plugin/unavailable" }));
    first.dispose();
    expect(getDefaultStore().get(contextActionsAtom)).toHaveLength(1);
    next.dispose();
    expect(getDefaultStore().get(contextActionsAtom)).toEqual([]);
  } finally { close(); }
});

test("header surfaces validate and only the shelf can take over the page", () => {
  const { context, close } = fixture();
  try {
    for (const surface of ["reader", "agent", "shelf"] as const) context.contributions.headerActions.register({
      id: surface, title: surface, surface, presentation: "page", view: () => ({ kind: "detail", content: [] }),
    });
    expect(getDefaultStore().get(headerActionsAtom).map(action => [action.surface, action.presentation]))
      .toEqual([["reader", "popup"], ["agent", "popup"], ["shelf", "page"]]);
    expect(() => context.contributions.headerActions.register({ surface: "unknown" } as unknown as PluginHeaderAction))
      .toThrow(expect.objectContaining({ code: "plugin/invalid-input" }));
    expect(() => context.contributions.contextActions.register({ surface: "unknown" } as unknown as PluginContextAction))
      .toThrow(expect.objectContaining({ code: "plugin/invalid-input" }));
  } finally { close(); }
});
