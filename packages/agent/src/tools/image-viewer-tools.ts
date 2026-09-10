import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, normalizeReaderImageRequest, type ReaderImageRequest } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";

export function buildImageViewerTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  return [{
    name: "get_reader_image", label: "Image viewer",
    description: "Read transform state of the already-open native book image viewer. Returns null when none is open, or another book is active in a book-scoped turn. No image URL, bytes, alt text or inferred image content. Scale is 1 (fit) to 8; rotation is clockwise quarter-turns; panX/panY are offsets in viewport fractions. Not book-page zoom or image discovery.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (_id, _input, signal) => {
      signal?.throwIfAborted();
      const image = await deps.reader.getImage();
      signal?.throwIfAborted();
      return textResult(scope.kind === "book" && image?.bookId !== scope.bookId ? null : image);
    },
  }, {
    name: "control_reader_image", label: "Adjust image viewer",
    description: "On explicit user intent, zoom in/out, rotate clockwise 90 degrees, reset, pan, or close the already-open image viewer. Copy id from get_reader_image; stale IDs cannot control another image. Pan dx/dy are fractions of viewport width/height, each -1..1; positive moves right/down, ignored at fit. Rotate resets zoom/pan, reset also clears rotation. Updated means React committed the returned state, not completed animation or a lock against concurrent user gestures. Does not open or discover images, copy bytes, or alter the reading position.",
    parameters: Type.Object({ request: Type.Union([
      Type.Object({ id: Type.String({ minLength: 1, maxLength: 256 }),
        action: Type.Union(["zoom-in", "zoom-out", "rotate", "reset", "close"].map(value => Type.Literal(value))) }, { additionalProperties: false }),
      Type.Object({ id: Type.String({ minLength: 1, maxLength: 256 }), action: Type.Literal("pan"),
        dx: Type.Number({ minimum: -1, maximum: 1 }), dy: Type.Number({ minimum: -1, maximum: 1 }) }, { additionalProperties: false }),
    ]) }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_id, input, signal) => {
      signal?.throwIfAborted();
      const request = normalizeReaderImageRequest((input as { request: ReaderImageRequest }).request);
      const current = await deps.reader.getImage();
      signal?.throwIfAborted();
      if (!current) throw new AppError("reader/unavailable", "No active image viewer");
      if (current.id !== request.id || scope.kind === "book" && current.bookId !== scope.bookId) throw new AppError("reader/superseded", "Image viewer belongs to another image or book");
      return textResult(await deps.reader.controlImage(request, signal));
    },
  }];
}
