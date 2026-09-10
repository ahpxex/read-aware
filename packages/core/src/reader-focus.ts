import { AppError } from "./errors";

export type ReaderFocusTarget = "content" | "toc" | "chat";
export type ReaderFocusOutcome = { status: "focused" } | { status: "not-focused"; reason: "missing" | "hidden" | "blocked" | "rejected" };
export type ReaderFocusReceipt = ReaderFocusOutcome & { target: ReaderFocusTarget; sessionId: string; bookId: string };

export function assertReaderFocusTarget(target: unknown): asserts target is ReaderFocusTarget {
  if (target !== "content" && target !== "toc" && target !== "chat") throw new AppError("reader/invalid-target", "Unknown reader focus target");
}
