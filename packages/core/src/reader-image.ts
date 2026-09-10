import { AppError } from "./errors";

export type ReaderImageTransform = { scale: number; rotation: number; panX: number; panY: number };
export type ReaderImageSnapshot = ReaderImageTransform & { id: string; bookId: string; sessionId: string; revision: number };
export type ReaderImageAction =
  | { action: "zoom-in" | "zoom-out" | "rotate" | "reset" | "close" }
  | { action: "pan"; dx: number; dy: number };
export type ReaderImageRequest = ReaderImageAction & { id: string };
export type ReaderImageReceipt =
  | { status: "updated"; snapshot: ReaderImageSnapshot }
  | { status: "closed"; id: string };

export function normalizeReaderImageRequest(input: ReaderImageRequest): ReaderImageRequest {
  const invalid = (): never => { throw new AppError("reader/invalid-target", "Invalid image-viewer request"); };
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.id !== "string"
    || !input.id || input.id.length > 256) return invalid();
  if (input.action === "pan") {
    if (!Number.isFinite(input.dx) || Math.abs(input.dx) > 1 || !Number.isFinite(input.dy) || Math.abs(input.dy) > 1
      || Object.keys(input).some(key => !["id", "action", "dx", "dy"].includes(key))) return invalid();
    return { id: input.id, action: "pan", dx: input.dx, dy: input.dy };
  }
  if (!["zoom-in", "zoom-out", "rotate", "reset", "close"].includes(input.action)
    || Object.keys(input).some(key => !["id", "action"].includes(key))) return invalid();
  return { id: input.id, action: input.action };
}
