import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, normalizeBookImageQuery, normalizeBookImagesQuery, type BookImageQuery, type BookImagesQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import type { AgentTurnState } from "./turn-state";
import { assertSpoilerPermission, confirmSpoilerSchema, spoilerGranted } from "./book-text-tools";
import { resolveBookId } from "./current-book";
import { textResult } from "./tool-result";

export function buildBookImageTools(scope: ThreadScope, deps: RuntimeDeps, state?: AgentTurnState): AgentTool[] {
  function access(bookId: string, raw: unknown) {
    if (scope.kind === "book" && bookId !== scope.bookId) throw new AppError("memory/forbidden", "Images belong to another book");
    const current = scope.kind === "book", grant = spoilerGranted(raw);
    assertSpoilerPermission(grant, state, current);
    return { current, grant, fence: current && state?.spoilerFence && !grant ? { throughChapterIndex: state.spoilerFence.throughChapterIndex } : {} };
  }
  return [{
    name: "list_book_images", label: "Book illustrations",
    description: "List image elements in one versioned book section, without loading image bytes, navigating or fetching remote URLs. Use sectionIndex/contentVersion from get_navigation_toc, not extracted chapter numbering. Returns up to 20 bounded alt labels, source locations and opaque image descriptors; continue with nextOffset. Covers img and SVG image elements, excluding footnote marker images, not CSS backgrounds or PDF embedded objects. Unsupported is distinct from an empty supported section. Current narrative sections remain behind the reading fence.",
    parameters: Type.Object({ bookId: Type.Optional(Type.String()), contentVersion: Type.String({ minLength: 1, maxLength: 256 }),
      sectionIndex: Type.Integer({ minimum: 0 }), offset: Type.Optional(Type.Integer({ minimum: 0 })), confirmSpoiler: confirmSpoilerSchema }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const { confirmSpoiler, ...input } = params as Omit<BookImagesQuery, "bookId"> & { bookId?: string; confirmSpoiler?: unknown };
      const query = normalizeBookImagesQuery({ ...input, bookId: resolveBookId(scope, input.bookId), limit: 20 });
      const { current, grant, fence } = access(query.bookId, confirmSpoiler);
      const result = await deps.bookText.listImages({ ...query, ...fence }, signal);
      signal?.throwIfAborted(); if (state && current && grant) state.spoilerGranted = true;
      return textResult(result);
    },
  }, {
    name: "open_book_image_resource", label: "Prepare book illustration", executionMode: "sequential",
    description: "Copy one embedded image from list_book_images into this conversation's temporary sealed resource. Copy the descriptor unchanged. Rechecks source section/version and narrative reading fence before loading; no network requests or original-book export bypass. Returns ready/missing/external/unsupported; ready means bytes copied, NOT decoded pixels or visual understanding. No image bytes, source URL or paths enter the model, and no viewer opens. Max 16 MiB; references last one hour and share existing resource quotas. Use save_resource or copy_resource_image only on user intent; clipboard decoding may reject unsupported formats. Release the reference when finished.",
    parameters: Type.Object({ image: Type.Object({ bookId: Type.String({ minLength: 1, maxLength: 512 }),
      contentVersion: Type.String({ minLength: 1, maxLength: 256 }), sectionIndex: Type.Integer({ minimum: 0 }), index: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
      confirmSpoiler: confirmSpoilerSchema }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const { confirmSpoiler, ...input } = params as BookImageQuery & { confirmSpoiler?: unknown };
      const query = normalizeBookImageQuery(input), { current, grant, fence } = access(query.image.bookId, confirmSpoiler);
      const result = await deps.bookText.openImageResource(threadScopeKey(scope), { ...query, ...fence }, signal);
      signal?.throwIfAborted(); if (state && current && grant) state.spoilerGranted = true;
      return textResult(result);
    },
  }];
}
