import { afterEach, expect, spyOn, test } from "bun:test";
import { AppError } from "@read-aware/core";
import type { PluginDisposable, PluginPermission } from "@read-aware/plugin-types";
import * as db from "../features/annotations/lib/annotation-db";
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
  const runtime = buildPluginContext({ id: "annotation-test", name: "Annotation test", version: "1.0.0", schemaVersion: 1, requires: { domains: { annotations: "^1.1.0" } }, permissions: permission ? [permission] : [] }, "0.5.4", disposables);
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

test("only annotation writers receive ask deletion; no plugin receives ask creation", async () => {
  own(spyOn(db, "getAnnotation").mockResolvedValue(ask));
  const remove = own(spyOn(db, "deleteAnnotation").mockResolvedValue());
  expect(plugin().context.domains.annotations).toBeUndefined();
  const reader = plugin("annotations:read").context.domains.annotations!;
  expect(await reader.queries.get("ask")).toMatchObject({ kind: "ask" });
  expect(reader.commands).toBeUndefined();
  const writer = plugin("annotations:write");
  expect(writer.context.domains.annotations!.commands).not.toHaveProperty("createAsk");
  await writer.context.domains.annotations!.commands!.removeAsk("ask");
  expect(remove).toHaveBeenCalledWith("ask", "plugin:annotation-test");
  writer.lifecycle.stop();
  expect(() => writer.context.domains.annotations!.commands!.removeAsk("ask")).toThrow();
  expect(remove).toHaveBeenCalledTimes(1);
});

test("ask deletion rejects wrong kinds, missing IDs and unauthorized trace creation", async () => {
  const read = own(spyOn(db, "getAnnotation").mockResolvedValue(highlight));
  const remove = own(spyOn(db, "deleteAnnotation").mockResolvedValue());
  const domain = createAnnotationsDomain("plugin:annotation-test");
  await expect(domain.commands.removeAsk("highlight")).rejects.toMatchObject({ code: "annotations/not-found" });
  read.mockResolvedValue(null);
  await expect(domain.commands.removeAsk("missing")).rejects.toMatchObject({ code: "annotations/not-found" });
  await expect(domain.commands.createAsk({ bookId: "book", text: "Fabricated" })).rejects.toMatchObject({ code: "annotations/forbidden" });
  await expect(domain.commands.createHighlight({ bookId: "book", text: "Text", style: "invalid" as "underline" })).rejects.toMatchObject({ code: "annotations/invalid-input" });
  expect(remove).not.toHaveBeenCalled();
});

test("Agent ask deletion uses the same exact lookup and removal verb", async () => {
  own(spyOn(db, "getAnnotation").mockResolvedValue(ask));
  const list = own(spyOn(db, "listAnnotations").mockRejectedValue(new Error("Must not scan")));
  const remove = own(spyOn(db, "deleteAnnotation").mockResolvedValue());
  await createAnnotationsPort().removeAnnotation("ask");
  expect(remove).toHaveBeenCalledWith("ask", "agent");
  expect(list).not.toHaveBeenCalled();
});
