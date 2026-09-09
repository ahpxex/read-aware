import { AppError } from "./errors";
import type { MemoryRecord } from "./memory-query";

/** Device-local row + event identity token. Never substitute updatedAt for revision. */
export type MemorySnapshot = { memory: MemoryRecord; revision: string };
export type MemoryMutation = { memoryId: string; expectedRevision: string } & (
  | { op: "correct"; content: string }
  | { op: "setPinned"; pinned: boolean }
  | { op: "forget" }
);
export type MemoryMutationReceipt = { memoryId: string; revision: string | null };

export function validateMemoryId(id: string): void {
  if (typeof id !== "string" || !id.trim() || id.length > 256) throw new AppError("memory/invalid-input", "Expected a memory ID");
}
export function normalizeMemoryMutation(input: MemoryMutation): MemoryMutation {
  const fail = (): never => { throw new AppError("memory/invalid-input", "Invalid conditional memory operation"); };
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  validateMemoryId(input.memoryId);
  if (typeof input.expectedRevision !== "string" || !/^mem1:[a-f0-9]{64}$/.test(input.expectedRevision)) return fail();
  const common = { memoryId: input.memoryId, expectedRevision: input.expectedRevision };
  const fields = ["memoryId", "expectedRevision", "op"];
  if (input.op === "correct") {
    fields.push("content");
    if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 16_000) return fail();
  } else if (input.op === "setPinned") {
    fields.push("pinned");
    if (typeof input.pinned !== "boolean") return fail();
  } else if (input.op !== "forget") return fail();
  if (Object.keys(input).some(key => !fields.includes(key))) return fail();
  return input.op === "correct" ? { ...common, op: input.op, content: input.content.trim() }
    : input.op === "setPinned" ? { ...common, op: input.op, pinned: input.pinned } : { ...common, op: "forget" };
}
