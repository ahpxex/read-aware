import { expect, test } from "bun:test";
import { fixture } from "./fixture";

test("intent preparation promotes the owner's durable legacy goal, then reads only its document", async () => {
  const host = fixture(), source = host.context.readingIntent!, scope = { kind: "book" as const, id: "book-1" };
  host.saved.set("goal:book-1", { text: "Compare evidence", suggestMemory: true });
  host.ctx.services.storage.get = () => { throw Error("Do not use optimistic KV"); };
  await expect(source.read(scope)).rejects.toMatchObject({ code: "memory/conflict" });
  await source.prepare(scope);
  expect(await source.read(scope)).toEqual({ text: "Compare evidence", revision: host.documents.get("book-1")!.revision });
  expect(host.commits).toHaveLength(1); expect(host.saved.has("goal:book-1")).toBe(false);
  host.state.bookId = "book-2";
  expect(await source.read(scope)).toHaveProperty("text", "Compare evidence");
  expect(await source.read({ kind: "book", id: "book-2" })).toEqual({ text: null, revision: null });
});
test("tombstones beat legacy bytes; invalid data and owner failures do not become missing intentions", async () => {
  const host = fixture(), source = host.context.readingIntent!, scope = { kind: "book" as const, id: "book-1" };
  host.documents.set("book-1", { revision: "cleared", data: { version: 1, goal: null } });
  host.saved.set("goal:book-1", { text: "old", suggestMemory: true });
  expect(await source.read(scope)).toEqual({ text: null, revision: "cleared" });
  host.state.failRemove = true;
  await expect(source.prepare(scope)).rejects.toThrow("cleanup failed");
  host.state.failRead = true;
  await expect(source.read(scope)).rejects.toThrow("read failed");
  host.state.failRead = false; host.documents.set("book-1", { revision: "broken", data: { version: 2 } });
  await expect(source.read(scope)).rejects.toMatchObject({ code: "plugin/invalid-input" });
  await expect(source.read({ kind: "user" })).rejects.toMatchObject({ code: "plugin/invalid-input" });
});
