import { afterEach, expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";
import type { PluginDisposable, PluginPermission } from "@read-aware/plugin-types";
import * as db from "../features/annotations/lib/annotation-db";
import * as mutations from "../features/annotations/lib/annotation-mutations";
import type { Ask, Highlight } from "../features/annotations/lib/annotation-types";
import { createAnnotationsPort } from "../features/ai/agent/ports/annotations-port";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import { createAnnotationsDomain } from "./annotations";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const own = <T extends { mockRestore(): void }>(spy: T): T => { cleanups.push(() => spy.mockRestore()); return spy; };
const ask: Ask = { id: "ask", bookId: "book", type: "ask", text: "Question", cfiRange: null, chapterHref: null, createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z" };
const highlight: Highlight = { ...ask, id: "highlight", type: "highlight", color: "blue", style: "underline", updatedAt: ask.createdAt };
function plugin(permission?: PluginPermission) {
  const disposables: PluginDisposable[] = [];
  const runtime = buildPluginContext({ id: "annotation-test", name: "Annotation test", version: "1.0.0", schemaVersion: 1, requires: { domains: { annotations: "^2.0.0" } }, permissions: permission ? [permission] : [] }, "0.5.4", disposables);
  runtime.lifecycle.promote();
  cleanups.push(() => runtime.lifecycle.stop());
  return runtime;
}

test("exact domain and Agent reads use annotation_get, preserve null and propagate failures", async () => {
  const read = own(spyOn(db, "getAnnotation").mockResolvedValue(ask));
  const list = own(spyOn(db, "listAnnotations").mockRejectedValue(new Error("Must not scan")));
  expect(await createAnnotationsDomain("user").queries.get("ask")).toMatchObject({ kind: "ask", id: "ask" });
  expect(await createAnnotationsPort().getAnnotation("ask")).toMatchObject({ kind: "ask", id: "ask" });
  expect(list).not.toHaveBeenCalled();
  read.mockResolvedValue(null);
  expect(await createAnnotationsPort().getAnnotation("missing")).toBeNull();
  read.mockRejectedValue(new AppError("db/locked", "Locked"));
  await expect(createAnnotationsDomain("user").queries.get("ask")).rejects.toMatchObject({ code: "db/locked" });
  await expect(createAnnotationsDomain("user").queries.get(42 as unknown as string)).rejects.toMatchObject({ code: "annotations/invalid-input" });
});

test("Agent adapter preserves underline style and kind filters", async () => {
  const create = own(spyOn(db, "createHighlight").mockResolvedValue(highlight));
  const list = own(spyOn(db, "listAnnotations").mockResolvedValue([ask]));
  const port = createAnnotationsPort();
  expect(await port.createHighlight({ bookId: "book", text: "Passage", style: "underline", color: "blue" })).toMatchObject({ style: "underline" });
  expect(create).toHaveBeenCalledWith("book", null, null, "Passage", "blue", "underline", "agent");
  await port.listAnnotations({ bookId: "book", kind: "ask" });
  expect(list).toHaveBeenCalledWith({ bookId: "book", type: "ask", searchQuery: undefined });
});

test("Agent and authorized plugins share native pages and preserve query/storage errors", async () => {
  const read = own(spyOn(db, "pageAnnotations").mockResolvedValue({ items: [ask], nextCursor: "opaque", consistency: "live" }));
  const list = own(spyOn(db, "listAnnotations").mockRejectedValue(new Error("Must not scan")));
  const input = { bookId: "book", kind: "ask" as const, limit: 5, cursor: "previous" };
  const runtime = plugin("annotations:read");
  const page = runtime.context.domains.annotations!.queries.page;
  for (const query of [page, createAnnotationsPort().pageAnnotations]) {
    expect(await query(input)).toMatchObject({ items: [{ id: "ask", kind: "ask" }], nextCursor: "opaque", consistency: "live" });
    expect(read).toHaveBeenLastCalledWith(input);
  }
  expect(list).not.toHaveBeenCalled();
  read.mockRejectedValue(new AppError("annotations/invalid-cursor", "Wrong filters"));
  await expect(page(input)).rejects.toMatchObject({ code: "annotations/invalid-cursor" });
  read.mockRejectedValue(new AppError("db/locked", "Locked"));
  await expect(createAnnotationsPort().pageAnnotations(input)).rejects.toMatchObject({ code: "db/locked" });
  expect(read).toHaveBeenCalledTimes(4);
});

test("only annotation writers receive conditional mutation; no plugin receives ask creation or unconditional aliases", async () => {
  own(spyOn(db, "getAnnotation").mockResolvedValue(ask));
  const apply = own(spyOn(mutations, "commitAnnotationMutations").mockResolvedValue({ atomic: true, changes: [{ annotationId: "ask", revision: null }] }));
  expect(plugin().context.domains.annotations).toBeUndefined();
  const reader = plugin("annotations:read").context.domains.annotations!;
  expect(await reader.queries.get("ask")).toMatchObject({ kind: "ask" });
  expect(reader.commands).toBeUndefined();
  const writer = plugin("annotations:write");
  const commands = writer.context.domains.annotations!.commands!;
  expect(Object.keys(commands).sort()).toEqual(["applyChanges", "createHighlight", "createNote"]);
  const changes = [{ op: "remove" as const, kind: "ask" as const, annotationId: "ask", expectedRevision: `ann1:${"a".repeat(64)}` }];
  await commands.applyChanges(changes);
  expect(apply.mock.calls[0]).toEqual([changes, "plugin:annotation-test", expect.any(AbortSignal)]);
  writer.lifecycle.stop();
  expect(() => commands.applyChanges(changes)).toThrow();
  expect(apply).toHaveBeenCalledTimes(1);
});

test("plugins cannot create fabricated traces or invalid highlight styles", async () => {
  const domain = createAnnotationsDomain("plugin:annotation-test");
  await expect(domain.commands.createAsk({ bookId: "book", text: "Fabricated" })).rejects.toMatchObject({ code: "annotations/forbidden" });
  await expect(domain.commands.createHighlight({ bookId: "book", text: "Text", style: "invalid" as "underline" })).rejects.toMatchObject({ code: "annotations/invalid-input" });
});

test("Agent mutations preserve the supplied revision without rereading and propagate native conflict", async () => {
  const read = own(spyOn(db, "getAnnotation").mockRejectedValue(new Error("Must not refresh token")));
  const list = own(spyOn(db, "listAnnotations").mockRejectedValue(new Error("Must not scan")));
  const apply = own(spyOn(mutations, "commitAnnotationMutations").mockRejectedValue(new AppError("annotations/conflict", "Changed")));
  const port = createAnnotationsPort();
  for (const key of ["removeAnnotation", "updateNote", "recolorHighlight"]) expect(port).not.toHaveProperty(key);
  const changes = [{ op: "remove" as const, kind: "ask" as const, annotationId: "ask", expectedRevision: `ann1:${"a".repeat(64)}` }];
  await expect(port.applyChanges(changes)).rejects.toMatchObject({ code: "annotations/conflict" });
  expect(apply).toHaveBeenCalledWith(changes, "agent", undefined);
  expect(read).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
});

test("conditional writes share actor origin, require write permission, and carry retirement signal", async () => {
  own(spyOn(mutations, "inspectAnnotation").mockResolvedValue({ annotation: ask, revision: `ann1:${"a".repeat(64)}` }));
  const apply = own(spyOn(mutations, "commitAnnotationMutations").mockResolvedValue({ atomic: true, changes: [{ annotationId: "ask", revision: null }] }));
  const reader = plugin("annotations:read").context.domains.annotations!;
  expect(await reader.queries.inspect("ask")).toMatchObject({ annotation: { kind: "ask" } });
  expect(reader.commands).toBeUndefined();
  const writer = plugin("annotations:write");
  const changes = [{ op: "remove" as const, kind: "ask" as const, annotationId: "ask", expectedRevision: `ann1:${"a".repeat(64)}` }];
  const command = writer.context.domains.annotations!.commands!.applyChanges;
  await command(changes);
  expect(apply.mock.calls[0][1]).toBe("plugin:annotation-test");
  const signal = apply.mock.calls[0][2]!;
  expect(signal.aborted).toBe(false);
  writer.lifecycle.stop();
  expect(signal.aborted).toBe(true);
  expect(() => command(changes)).toThrow();
  const controller = new AbortController();
  await createAnnotationsPort().applyChanges(changes, controller.signal);
  expect(apply).toHaveBeenLastCalledWith(changes, "agent", controller.signal);
});
