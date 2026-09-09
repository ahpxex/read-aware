import { expect, test } from "bun:test";
import { PluginFormDraft, PluginFormDrafts } from "./plugin-form-drafts";
import { PluginViewSession } from "./plugin-view-session";
import type { PluginFormField, PluginFormView, PluginView } from "./plugin-types";

const fields = (value = "Stored"): PluginFormField[] => [
  { kind: "text", id: "query", label: "Query", value },
  { kind: "number", id: "limit", label: "Limit", value: 10 },
];
const form = (value?: string): PluginFormView => ({ kind: "form", fields: fields(value), onSubmit: () => null });
const currentDraft = (session: PluginViewSession) => {
  const state = session.getSnapshot();
  return state.forms!.get(state.stack.at(-1) as PluginFormView)!;
};

test("refresh adopts unchanged fields, preserves edits and removes stale fields or kinds", () => {
  const draft = new PluginFormDraft(fields());
  draft.update("query", "Draft");
  draft.reconcile([{ ...fields("Remote")[0] }, { ...fields()[1], value: 20 } as PluginFormField]);
  expect(draft.getSnapshot()).toEqual({ query: "Draft", limit: 20 });
  draft.reconcile(fields("Draft"));
  draft.reconcile(fields("Acknowledged then remote"));
  expect(draft.getSnapshot()).toEqual({ query: "Acknowledged then remote", limit: 10 });
  draft.reconcile([{ kind: "number", id: "query", label: "Query", value: 2 }]);
  expect(draft.getSnapshot()).toEqual({ query: 2 });
  draft.update("query", "stale text callback");
  draft.update("limit", 4);
  draft.update("query", NaN);
  expect(draft.getSnapshot()).toEqual({ query: 2 });
});

test("secret adapter fields are excluded and password drafts are cleared on hide", () => {
  const draft = new PluginFormDraft([...fields(),
    { kind: "secret", id: "key", label: "Key" },
    { kind: "text", inputMode: "password", id: "password", label: "Password" },
  ]);
  draft.update("key", "must not enter values");
  draft.update("password", "private");
  draft.update("query", "Public draft");
  draft.hide();
  expect(draft.getSnapshot()).toEqual({ query: "Public draft", limit: 10, password: "" });
  draft.dispose(); draft.update("query", "late"); draft.reconcile(fields());
  expect(draft.getSnapshot()).toEqual({});
});

test("snapshot identity is stable for no-op reconciliation and safe for arbitrary field IDs", () => {
  const declared: PluginFormField[] = [{ kind: "text", id: "__proto__", label: "Field", value: "default" }];
  const draft = new PluginFormDraft(declared);
  let calls = 0;
  const stop = draft.subscribe(() => calls++);
  const snapshot = draft.getSnapshot();
  draft.reconcile(declared);
  expect(draft.getSnapshot()).toBe(snapshot);
  draft.update("__proto__", "edited");
  expect(Object.hasOwn(draft.getSnapshot(), "__proto__")).toBe(true);
  expect(draft.getSnapshot()["__proto__"]).toBe("edited");
  expect(calls).toBe(1);
  stop(); draft.dispose();
  expect(calls).toBe(1);
});

test("nested forms get independent drafts across every layout and structural replacement", () => {
  const build = () => {
    const forms = Array.from({ length: 5 }, () => form());
    const view: PluginView = { kind: "detail", content: [
      forms[0],
      { kind: "section", blocks: [{ kind: "group", blocks: [forms[1]] }] },
      { kind: "columns", cells: [{ blocks: [forms[2]] }] },
      { kind: "row", cells: [{ block: forms[3] }] },
      forms[4],
    ] };
    return { forms, view };
  };
  const first = build(), owner = new PluginFormDrafts(first.view);
  first.forms.forEach((view, i) => owner.get(view)!.update("query", `Draft ${i}`));
  const refreshed = build(); owner.reconcile(refreshed.view);
  refreshed.forms.forEach((view, i) => expect(owner.get(view)!.getSnapshot().query).toBe(`Draft ${i}`));
  const retired = owner.get(refreshed.forms[0])!;
  owner.reconcile({ kind: "markdown", markdown: "No form" });
  expect(retired.getSnapshot()).toEqual({});
  owner.reconcile(first.view);
  expect(owner.get(first.forms[0])!.getSnapshot().query).toBe("Stored");
  owner.dispose(); owner.reconcile(first.view);
  expect(owner.get(first.forms[0])).toBeUndefined();
});

test("navigation frames retain drafts on back but replacement, reset and disposal erase them", async () => {
  const session = new PluginViewSession(); session.setRoot(form());
  const parent = currentDraft(session); parent.update("query", "Parent draft");
  const parentKey = session.getSnapshot().renderKey;
  await session.run(() => ({ view: form("Child") }));
  const child = currentDraft(session); child.update("query", "Child draft");
  let staleCalls = 0;
  expect(await session.runFrom(parentKey, () => { staleCalls++; return null; })).toBeNull();
  expect(staleCalls).toBe(0);
  session.back();
  expect(currentDraft(session)).toBe(parent);
  expect(parent.getSnapshot().query).toBe("Parent draft");
  expect(child.getSnapshot()).toEqual({});
  session.setRoot(form("External"));
  expect(currentDraft(session)).toBe(parent);
  expect(parent.getSnapshot().query).toBe("Parent draft");
  await session.run(() => ({ view: form("Replacement"), navigation: "replace" }));
  expect(parent.getSnapshot()).toEqual({});
  expect(currentDraft(session).getSnapshot().query).toBe("Replacement");
  const replacement = currentDraft(session);
  await session.run(() => ({ view: form("Reset"), navigation: "reset" }));
  expect(replacement.getSnapshot()).toEqual({});
  const reset = currentDraft(session); session.dispose();
  expect(reset.getSnapshot()).toEqual({});
  expect(session.getSnapshot().forms).toBeNull();
});

test("modal uses a separate owner, clears underlying passwords and denies hidden page callbacks", async () => {
  const session = new PluginViewSession();
  session.setRoot({ ...form(), fields: [...fields(), { kind: "text", id: "password", label: "Password", inputMode: "password" }] });
  const parent = currentDraft(session), key = session.getSnapshot().renderKey;
  parent.update("password", "private"); parent.update("query", "Keep");
  await session.runFrom(key, () => ({ view: form("Modal") }), { presentation: "dialog" });
  const modal = session.getSnapshot().dialog!.session;
  expect(currentDraft(modal).getSnapshot().query).toBe("Modal");
  expect(parent.getSnapshot()).toEqual({ query: "Keep", limit: 10, password: "" });
  let calls = 0;
  await session.runFrom(key, () => { calls++; return null; });
  expect(calls).toBe(0);
  const modalDraft = currentDraft(modal); session.closeDialog();
  expect(modalDraft.getSnapshot()).toEqual({});
  await session.runFrom(key, () => { calls++; return null; });
  expect(calls).toBe(1);
  expect(currentDraft(session)).toBe(parent);
  session.dispose();
});
