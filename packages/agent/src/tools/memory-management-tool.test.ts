import { expect, test } from "bun:test";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import { buildMemoryManagementTool } from "./memory-management-tool";
import type { Id } from "@read-aware/core";

const scope = { kind: "book" as const, bookId: "book" as Id };
function fixture() {
  const f = createInMemoryDeps({ memories: [seedMemory({ id: "m", scope: "user", content: "Original" }), seedMemory({ id: "other", scope: "book:other", content: "Private" })] });
  return { ...f, tool: buildMemoryManagementTool(scope, f.deps) };
}
test("Agent inspects then approves exact correction, pin and forgetting", async () => {
  const f = fixture();
  const inspect = await f.tool.execute("read", { action: "inspect", memoryId: "m" });
  expect(inspect.content[0]?.type).toBe("text");
  for (const change of [{ action: "correct", content: "Corrected" }, { action: "setPinned", pinned: true }, { action: "forget" }]) {
    const snapshot = (await f.deps.memoryManagement.inspect("m"))!;
    await f.tool.execute(change.action, { ...change, memoryId: "m", expectedRevision: snapshot.revision });
  }
  expect(f.stores.memories[0]).toMatchObject({ content: "Corrected", pinned: true, status: "forgotten", importance: 0.5, evidenceCount: 1, scope: "user" });
  expect(f.stores.interactions).toHaveLength(3);
  expect(f.stores.interactions[0]).toMatchObject({ kind: "permission", action: "manage-memory" });
});
test("decline, invalid fields and wrong-book access never mutate", async () => {
  const f = fixture(), revision = (await f.deps.memoryManagement.inspect("m"))!.revision;
  f.deps.interactions.request = async () => ({ optionId: "decline" });
  await f.tool.execute("decline", { action: "forget", memoryId: "m", expectedRevision: revision });
  expect(await f.deps.memoryManagement.inspect("m")).not.toBeNull();
  await expect(f.tool.execute("scope", { action: "inspect", memoryId: "other" })).rejects.toMatchObject({ code: "memory/forbidden" });
  await expect(f.tool.execute("fields", { action: "correct", memoryId: "m", expectedRevision: revision, content: "Overwrite", importance: 1 })).rejects.toMatchObject({ code: "memory/invalid-input" });
  expect(f.stores.memories[0]!.content).toBe("Original");
});
test("a concurrent writer during approval is not overwritten or silently rebased", async () => {
  const f = fixture(), revision = (await f.deps.memoryManagement.inspect("m"))!.revision;
  f.deps.interactions.request = async () => {
    await f.deps.memoryManagement.mutate({ op: "correct", memoryId: "m", expectedRevision: revision, content: "Other writer" });
    return { optionId: "approve" };
  };
  await expect(f.tool.execute("race", { action: "correct", memoryId: "m", expectedRevision: revision, content: "Lost edit" })).rejects.toMatchObject({ code: "memory/conflict" });
  expect(f.stores.memories[0]!.content).toBe("Other writer");
});

test("approval freezes the requested change even when the original arguments change", async () => {
  const f = fixture(), revision = (await f.deps.memoryManagement.inspect("m"))!.revision;
  const params = { action: "correct", memoryId: "m", expectedRevision: revision, content: "Approved correction" };
  f.deps.interactions.request = async request => {
    expect(request).toMatchObject({ kind: "permission", action: "manage-memory" });
    if (request.kind === "permission") expect(request.subject).toContain("Approved correction");
    params.content = "Unapproved replacement";
    params.memoryId = "other";
    return { optionId: "approve" };
  };
  await f.tool.execute("frozen", params);
  expect(f.stores.memories[0]!.content).toBe("Approved correction");
  expect(f.stores.memories[1]!.content).toBe("Private");
});

test("cancellation before inspection or while approving prevents mutation", async () => {
  const f = fixture(), revision = (await f.deps.memoryManagement.inspect("m"))!.revision;
  const abort = new AbortController();
  abort.abort();
  await expect(f.tool.execute("cancelled-read", { action: "inspect", memoryId: "m" }, abort.signal)).rejects.toMatchObject({ code: "memory/cancelled" });
  expect(f.stores.interactions).toHaveLength(0);
  const pending = new AbortController();
  f.deps.interactions.request = async () => {
    pending.abort();
    return { optionId: "approve" };
  };
  await expect(f.tool.execute("cancelled-write", { action: "forget", memoryId: "m", expectedRevision: revision }, pending.signal)).rejects.toMatchObject({ code: "memory/cancelled" });
  expect(await f.deps.memoryManagement.inspect("m")).not.toBeNull();
});
