import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  validateModelImages,
  MODEL_IMAGES_MAX_COUNT,
  MODEL_IMAGES_MAX_BYTES,
  AppError,
  errorCode,
  normalizeBookImageQuery,
  normalizeBookImagesQuery,
  type BookImageQuery,
  type BookImagesQuery,
} from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import type { AgentTurnState } from "./turn-state";
import { assertSpoilerPermission, spoilerParameters, spoilerGranted } from "./book-text-tools";
import { isCurrentBookArg, nestedBookIdArg, resolveBookId } from "./current-book";
import { resourceTextResult as textResult } from "./tool-result";
import { int, obj, opt, str } from "@earendil-works/pi-schema";

function imageParameters(scope: ThreadScope, state?: AgentTurnState) {
  return spoilerParameters(
    scope,
    {
      image: obj({
        bookId: str({ minLength: 1, maxLength: 512 }),
        contentVersion: str({ minLength: 1, maxLength: 256 }),
        sectionIndex: int({ minimum: 0 }),
        index: int({ minimum: 0 }),
      }),
    },
    state,
    (args) => isCurrentBookArg(scope, nestedBookIdArg(args, "image")),
  );
}

export function buildBookImageTools(scope: ThreadScope, deps: RuntimeDeps, state?: AgentTurnState): AgentTool[] {
  async function withSourceRecovery<T>(bookId: string, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (errorCode(error) !== "reader/stale-location") throw error;
      const args = scope.kind === "book" ? { view: "navigation" } : { bookId, view: "navigation" };
      throw new AppError(
        "reader/stale-location",
        `The supplied contentVersion or image descriptor is stale or invented. Do not retry the same arguments. Next call get_toc with ${JSON.stringify(args)}, then use its returned contentVersion and source sectionIndex in list_book_images. Copy a fresh returned image descriptor to read_book_image. This failure does not mean there are no images. If discovery fails, report that failure instead of repeating this call.`,
        { cause: error },
      );
    }
  }
  function access(bookId: string, raw: unknown) {
    if (scope.kind === "book" && bookId !== scope.bookId)
      throw new AppError(
        "memory/forbidden",
        "This book context cannot access that image bookId. For the current book, call get_toc(view=navigation) and list_book_images without bookId; use their returned source version and image descriptor. An access error does not mean the book has no images.",
      );
    const current = scope.kind === "book",
      grant = spoilerGranted(raw);
    assertSpoilerPermission(grant, state, current);
    return {
      current,
      grant,
      fence:
        current && state?.spoilerFence && !grant ? { throughChapterIndex: state.spoilerFence.throughChapterIndex } : {},
    };
  }
  let imageCount = 0,
    imageBytes = 0;
  return [
    {
      name: "list_book_images",
      label: "Book illustrations",
      description:
        "List authored image candidates in one versioned book section without navigating or fetching remote URLs; PDF operator inspection may decode embedded objects. First call get_navigation_toc for sectionIndex/contentVersion, not extracted chapter numbering; never invent these values. In a book conversation omit bookId to use the current book. Returns up to 20 bounded alt labels, source locations and opaque image descriptors; continue with nextOffset. Covers img/SVG, srcset/picture alternatives, authored CSS image URLs and PDF embedded bitmaps. CSS candidates are declarations, not the active viewport/cascade. PDF masks depending on page paint state return unsupported when read. Footnote marker images are excluded. Unsupported and access failure are distinct from an empty supported section. Current narrative sections remain behind the reading fence.",
      ...spoilerParameters(
        scope,
        {
          bookId: opt(str()),
          contentVersion: str({ minLength: 1, maxLength: 256 }),
          sectionIndex: int({ minimum: 0 }),
          offset: opt(int({ minimum: 0 })),
        },
        state,
        (args) => isCurrentBookArg(scope, args.bookId),
      ),
      execute: async (_id, params, signal) => {
        signal?.throwIfAborted();
        const { confirmSpoiler, ...input } = params as Omit<BookImagesQuery, "bookId"> & {
          bookId?: string;
          confirmSpoiler?: unknown;
        };
        const query = normalizeBookImagesQuery({ ...input, bookId: resolveBookId(scope, input.bookId), limit: 20 });
        const { current, grant, fence } = access(query.bookId, confirmSpoiler);
        const result = await withSourceRecovery(query.bookId, () =>
          deps.bookText.listImages({ ...query, ...fence }, signal),
        );
        signal?.throwIfAborted();
        if (state && current && grant) state.spoilerGranted = true;
        return textResult(result);
      },
    },
    {
      name: "open_book_image_resource",
      label: "Prepare book illustration",
      executionMode: "sequential",
      description:
        "Copy one embedded image from list_book_images into this conversation's temporary sealed resource. Copy the descriptor unchanged. Rechecks source section/version and narrative reading fence before loading; no network requests or original-book export bypass. Returns ready/missing/external/unsupported; ready means bytes copied, NOT decoded pixels or visual understanding. No image bytes, source URL or paths enter the model, and no viewer opens. Max 16 MiB; references last one hour and share existing resource quotas. Use save_resource or copy_resource_image only on user intent; clipboard decoding may reject unsupported formats. Release the reference when finished.",
      ...imageParameters(scope, state),
      execute: async (_id, params, signal) => {
        signal?.throwIfAborted();
        const { confirmSpoiler, ...input } = params as BookImageQuery & { confirmSpoiler?: unknown };
        const query = normalizeBookImageQuery(input),
          { current, grant, fence } = access(query.image.bookId, confirmSpoiler);
        const result = await withSourceRecovery(query.image.bookId, () =>
          deps.bookText.openImageResource(threadScopeKey(scope), { ...query, ...fence }, signal),
        );
        signal?.throwIfAborted();
        if (state && current && grant) state.spoilerGranted = true;
        return textResult(result);
      },
    },
    {
      name: "show_book_image",
      label: "Show book illustration",
      executionMode: "sequential",
      description:
        "On explicit user intent, open an embedded image from list_book_images in the currently open book's native lightbox. Copy its versioned descriptor unchanged; open that book first. Preserves the narrative reading fence and does not fetch remote images or navigate. Opened means the matching viewer committed, not successful pixel decoding or model vision. Returns not-opened for missing/external/unsupported images. Use the returned snapshot.id with control_reader_image to zoom, pan, rotate, reset or close. No temporary resource handle is created; viewer bytes are released on replacement/close. A later user click, request or book change supersedes a pending opening.",
      ...imageParameters(scope, state),
      execute: async (_id, params, signal) => {
        signal?.throwIfAborted();
        const { confirmSpoiler, ...input } = params as BookImageQuery & { confirmSpoiler?: unknown };
        const query = normalizeBookImageQuery(input),
          { current, grant, fence } = access(query.image.bookId, confirmSpoiler);
        const session = await deps.reader.getSession();
        signal?.throwIfAborted();
        if (session.status !== "ready" || !session.sessionId)
          throw new AppError("reader/unavailable", "Open the image book first");
        const result = await withSourceRecovery(query.image.bookId, () =>
          deps.reader.openImage({ ...query, ...fence }, signal, {
            sessionId: session.sessionId!,
            bookId: query.image.bookId,
          }),
        );
        signal?.throwIfAborted();
        if (state && current && grant) state.spoilerGranted = true;
        return textResult(result);
      },
    },
    {
      name: "read_book_image",
      label: "Read book illustration",
      executionMode: "sequential",
      description:
        "Inspect one versioned illustration from list_book_images with the current vision model. Rechecks original source/version and narrative fence; no remote image fetch or original-book bypass. The host decodes a bounded PNG and returns an actual image block to the model. Missing/external/unsupported remain explicit. Maximum 4 images/16 MiB per turn, 8 MiB per image; source decoding also has dimension limits. The temporary resource is released automatically. Image blocks are omitted from later turns; reread a descriptor when needed. This does not open a viewer or guarantee semantic recognition.",
      ...imageParameters(scope, state),
      execute: async (_id, params, signal) => {
        signal?.throwIfAborted();
        const { confirmSpoiler, ...input } = params as BookImageQuery & { confirmSpoiler?: unknown };
        const query = normalizeBookImageQuery(input),
          { current, grant, fence } = access(query.image.bookId, confirmSpoiler);
        if (state?.modelSupportsImages === false)
          throw new AppError("ai/image-unsupported", "Current model does not support image inputs");
        if (!deps.bookText.readImageInput)
          throw new AppError("library/content-unavailable", "Image model input is unavailable");
        if ((state?.modelImageCount ?? imageCount) >= MODEL_IMAGES_MAX_COUNT)
          throw new AppError("ai/image-budget-exceeded", "This turn has reached its image input limit");
        const result = await withSourceRecovery(query.image.bookId, () =>
          deps.bookText.readImageInput!(threadScopeKey(scope), { ...query, ...fence }, signal),
        );
        signal?.throwIfAborted();
        if (result.status !== "ready") return textResult(result);
        const [image] = validateModelImages([result.input]);
        const bytes = (image.data.length / 4) * 3 - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0);
        if ((state?.modelImageBytes ?? imageBytes) + bytes > MODEL_IMAGES_MAX_BYTES)
          throw new AppError("ai/image-budget-exceeded", "This turn has reached its image byte limit");
        if (state) {
          state.modelImageCount = (state.modelImageCount ?? 0) + 1;
          state.modelImageBytes = (state.modelImageBytes ?? 0) + bytes;
        } else {
          imageCount++;
          imageBytes += bytes;
        }
        if (state && current && grant) state.spoilerGranted = true;
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ status: "ready", image: result.image }) },
            { type: "image" as const, ...image },
          ],
          details: undefined,
        };
      },
    },
  ];
}
