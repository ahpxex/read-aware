import type { PluginCallOptions, PluginLibraryDomain } from "@read-aware/plugin-types";
import { restricted, restrictSurface, type RestrictedPolicy } from "../plugin-restricted-surface";
import { AppError } from "@read-aware/core";
import { afterLocalKVWrites } from "../../../../platform/local-store";
import { openBookImageResource } from "../../../../domain/library-book-images";
import { importResourceBook } from "../../../../domain/library-resource-import";
import { inspectResourceBook } from "../../../../domain/book-inspection";
import {
  withVirtualBookBinding,
  findVirtualBookId,
  removeOwnedVirtualBook,
  invalidateOwnedVirtualBook,
  unbindVirtualBookDurably,
} from "../../lib/virtual-books";
import type { PluginContext } from "../../lib/plugin-types";
import { pluginObjectAccessDenied } from "../../../../domain/plugin-object-access";
import { guardMutationTree } from "./helpers";
import { createLogger } from "../../../../platform/logger";
import type { PluginActorKit } from "./kit";

const log = createLogger("plugins");

/** The library domain, with virtual-book bindings and book-grant narrowing. */
export function installLibraryDomain(
  kit: PluginActorKit,
  ctx: PluginContext,
  library: NonNullable<PluginActorKit["domain"]["library"]>,
): void {
  const {
    manifest,
    grantedBookAccess,
    lifecycle,
    callSignal,
    currentBook,
    objectAccess,
    scopedRead,
    scopedCommand,
    resources,
    importTasks,
    operationActor,
    track,
    trackedOn,
  } = kit;
  ctx.domains.library = {
    queries: {
      ...library.queries,
      books: {
        ...library.queries.books,
        getImportTask: (taskId, waitMs, options) => importTasks.wait(taskId, waitMs, callSignal(options)),
        listImportTasks: async () => importTasks.list(),
        inspectResource: (id, options) =>
          lifecycle.read(
            "library.inspectResource",
            (signal) => inspectResourceBook(resources, id, signal),
            callSignal(options),
          ),
        getNavigationToc: (bookId, options) =>
          lifecycle.read(
            "library.getNavigationToc",
            (signal) => library.queries.books.getNavigationToc(bookId, signal),
            callSignal(options),
          ),
        listNavigationTargets: (input, options) =>
          lifecycle.read(
            "library.listNavigationTargets",
            (signal) => library.queries.books.listNavigationTargets(input, signal),
            callSignal(options),
          ),
        searchLocations: (input, options) =>
          lifecycle.read(
            "library.searchLocations",
            (signal) => library.queries.books.searchLocations(input, signal),
            callSignal(options),
          ),
        readRange: (input, options) =>
          lifecycle.read(
            "library.readRange",
            (signal) => library.queries.books.readRange(input, signal),
            callSignal(options),
          ),
        listReferences: (input, options) =>
          lifecycle.read(
            "library.listReferences",
            (signal) => library.queries.books.listReferences(input, signal),
            callSignal(options),
          ),
        listImages: (input, options) =>
          lifecycle.read(
            "library.listImages",
            (signal) => library.queries.books.listImages(input, signal),
            callSignal(options),
          ),
        openImageResource: (input) =>
          lifecycle.read("library.openImageResource", () => openBookImageResource(resources, input, lifecycle.signal)),
        readReference: (input, options) =>
          lifecycle.read(
            "library.readReference",
            (signal) => library.queries.books.readReference(input, signal),
            callSignal(options),
          ),
        searchText: (input, options) =>
          lifecycle.read(
            "library.searchText",
            (signal) => library.queries.books.searchText(input, signal),
            callSignal(options),
          ),
        getContentState: (bookId, options) =>
          lifecycle.read(
            "library.getContentState",
            (signal) => library.queries.books.getContentState(bookId, signal),
            callSignal(options),
          ),
        listTextTaskHistory: (bookId, query) =>
          lifecycle.read("library.textTaskHistory", () => library.queries.books.listTextTaskHistory(bookId, query)),
        listRemovalCleanup: library.queries.books.listRemovalCleanup,
      },
    },
    events: {
      subscribe: trackedOn(library.events.subscribe),
      observeInvalidation: (handler) => track(() => ({ dispose: library.events.observeInvalidation(handler) })),
      observeTextTask: (bookId, taskId, listener) =>
        track(() => ({ dispose: library.events.observeTextTask(bookId, taskId, listener) })),
      observeImportTask: (taskId, listener) =>
        track(() => ({ dispose: importTasks.observe(taskId, listener, operationActor) })),
      observeEnrichment: (bookId, listener) =>
        track(() => ({ dispose: library.events.observeEnrichment(bookId, listener) })),
      observeContentState: (bookId, listener) =>
        track(() => ({ dispose: library.events.observeContentState(bookId, listener) })),
    },
  };
  if (library.commands) {
    const commands = {
      books: {
        prepareText: (bookId: string, options?: import("@read-aware/core").BookTextPrepareOptions) =>
          library.commands!.books.prepareText(bookId, options),
        retryEnrichment: (bookId: string) => library.commands!.books.retryEnrichment(bookId, lifecycle.signal),
        mergeDuplicates: (input: import("@read-aware/core").BookMergeRequest) =>
          library.commands!.books.mergeDuplicates(input, lifecycle.signal),
        setTextTaskPriority: library.commands.books.setTextTaskPriority,
        pauseTextTask: library.commands.books.pauseTextTask,
        resumeTextTask: library.commands.books.resumeTextTask,
        cancelTextTask: library.commands.books.cancelTextTask,
        importBook: (input: { fileName: string; data: ArrayBuffer | Uint8Array }, options?: PluginCallOptions) =>
          library.commands!.books.importBook(input, callSignal(options)),
        importResource: (id: string, options?: PluginCallOptions) =>
          importResourceBook(resources, id, operationActor, callSignal(options)),
        startImport: (input: import("@read-aware/core").BookImportRequest, options?: PluginCallOptions) =>
          importTasks.start(input, callSignal(options), operationActor),
        cancelImportTask: async (id: string) => importTasks.cancel(id, operationActor),
        editMetadata: library.commands.books.editMetadata,
        setStarred: library.commands.books.setStarred,
        remove: library.commands.books.remove,
        removeMany: library.commands.books.removeMany,
        retryRemovalCleanup: library.commands.books.retryRemovalCleanup,
        addVirtualBook: async (
          input: Parameters<
            NonNullable<NonNullable<PluginContext["domains"]["library"]>["commands"]>["books"]["addVirtualBook"]
          >[0],
        ) => {
          if (
            !input ||
            typeof input.providerId !== "string" ||
            !input.providerId.trim() ||
            input.providerId.length > 256 ||
            typeof input.key !== "string" ||
            !input.key ||
            input.key.length > 8192 ||
            typeof input.title !== "string" ||
            (input.author !== undefined && typeof input.author !== "string")
          )
            throw new AppError("plugin/invalid-argument", "Invalid virtual book metadata");
          const binding = { pluginId: manifest.id, providerId: input.providerId, key: input.key };
          const metadata = { title: input.title, author: input.author };
          return lifecycle.storageWrite("library.addVirtualBook", () =>
            withVirtualBookBinding(binding, async () => {
              lifecycle.assertActive("library.addVirtualBook");
              const existingId = await afterLocalKVWrites(() => findVirtualBookId(binding));
              if (existingId) {
                const alive = await library.queries.books.get(existingId);
                lifecycle.assertActive("library.addVirtualBook");
                if (alive) {
                  if (alive.format !== "virtual")
                    throw new AppError("db/error", "Virtual binding points to a non-virtual book");
                  await library.commands!.books.updateVirtualBookTitle(existingId, metadata.title, metadata.author);
                  return { ...alive, title: metadata.title, author: metadata.author ?? alive.author };
                }
                await unbindVirtualBookDurably(existingId, binding);
              }
              lifecycle.assertActive("library.addVirtualBook");
              return library.commands!.books.addVirtualBook({ ...metadata, binding });
            }),
          );
        },
        removeVirtualBook: async (
          input: Parameters<
            NonNullable<NonNullable<PluginContext["domains"]["library"]>["commands"]>["books"]["removeVirtualBook"]
          >[0],
        ) => {
          const binding = { pluginId: manifest.id, providerId: String(input.providerId), key: String(input.key) };
          const expectedBookId = input.expectedBookId;
          await lifecycle.storageWrite("library.removeVirtualBook", () =>
            withVirtualBookBinding(binding, async () => {
              lifecycle.assertActive("library.removeVirtualBook");
              await removeOwnedVirtualBook(binding, library.commands!.books.remove, expectedBookId);
            }),
          );
        },
        invalidateVirtualBook: (input: { providerId: string; key: string }) =>
          invalidateOwnedVirtualBook(
            {
              pluginId: manifest.id,
              providerId: String(input.providerId),
              key: String(input.key),
            },
            library.queries.books.get,
            lifecycle.signal,
            operationActor,
          ),
      },
      collections: library.commands.collections,
    };
    ctx.domains.library.commands = guardMutationTree(
      commands,
      (operation) => lifecycle.assertActive(operation),
      "domains.library.commands",
    );
  }
  if (objectAccess.restricted) {
    const queryBooks = library.queries.books;
    const verifyBook = (operation: string) => (value: { id?: string } | null) => {
      if (value) objectAccess.assertReturnedBook(value.id, operation);
    };
    const verifyBookId = (operation: string) => (value: { bookId?: string } | null) => {
      if (value) objectAccess.assertReturnedBook(value.bookId, operation);
    };
    const commandPolicy = (
      commands: NonNullable<typeof library.commands>,
    ): RestrictedPolicy<NonNullable<PluginLibraryDomain["commands"]>> => {
      const commandBooks = commands.books;
      const verifyTask = (operation: string) => (value: { bookId?: string } | null) => {
        if (value) objectAccess.assertReturnedBook(value.bookId, operation);
      };
      return {
        books: {
          prepareText: restricted.command(async (bookId, options) => {
            const operation = "library.commands.books.prepareText";
            const fence = await objectAccess.beginBook(bookId, operation);
            const cancel = new AbortController();
            const signal = AbortSignal.any([lifecycle.signal, cancel.signal, ...(fence.signal ? [fence.signal] : [])]);
            let disposed = false;
            const access = {
              signal,
              isAllowed: () => !disposed && !signal.aborted,
              dispose: () => {
                if (!disposed) {
                  disposed = true;
                  fence.dispose();
                }
              },
            };
            try {
              const task = await commandBooks.prepareText(bookId, options, access);
              verifyTask(operation)(task);
              await fence.assertUnchanged({ retain: true });
              return task;
            } catch (error) {
              cancel.abort(error);
              access.dispose();
              throw error;
            }
          }),
          retryEnrichment: restricted.command((bookId) =>
            scopedCommand(
              bookId,
              "library.commands.books.retryEnrichment",
              (signal) => commandBooks.retryEnrichment(bookId, signal),
              undefined,
              true,
              (value) =>
                objectAccess.assertReturnedBook(value.snapshot.bookId, "library.commands.books.retryEnrichment"),
            ),
          ),
          mergeDuplicates: restricted.deny,
          setTextTaskPriority: restricted.command((bookId, taskId, priority) =>
            scopedCommand(
              bookId,
              "library.commands.books.setTextTaskPriority",
              () => commandBooks.setTextTaskPriority(bookId, taskId, priority),
              undefined,
              true,
              verifyTask("library.commands.books.setTextTaskPriority"),
            ),
          ),
          pauseTextTask: restricted.command((bookId, taskId) =>
            scopedCommand(
              bookId,
              "library.commands.books.pauseTextTask",
              () => commandBooks.pauseTextTask(bookId, taskId),
              undefined,
              true,
              verifyTask("library.commands.books.pauseTextTask"),
            ),
          ),
          resumeTextTask: restricted.command((bookId, taskId) =>
            scopedCommand(
              bookId,
              "library.commands.books.resumeTextTask",
              () => commandBooks.resumeTextTask(bookId, taskId),
              undefined,
              true,
              verifyTask("library.commands.books.resumeTextTask"),
            ),
          ),
          cancelTextTask: restricted.command((bookId, taskId) =>
            scopedCommand(
              bookId,
              "library.commands.books.cancelTextTask",
              () => commandBooks.cancelTextTask(bookId, taskId),
              undefined,
              true,
              verifyTask("library.commands.books.cancelTextTask"),
            ),
          ),
          importBook: restricted.deny,
          importResource: restricted.deny,
          startImport: restricted.deny,
          cancelImportTask: restricted.deny,
          editMetadata: restricted.command((bookId, patch) =>
            scopedCommand(
              bookId,
              "library.commands.books.editMetadata",
              () => commandBooks.editMetadata(bookId, patch),
              undefined,
              false,
            ),
          ),
          setStarred: restricted.command((bookId, starred) =>
            scopedCommand(
              bookId,
              "library.commands.books.setStarred",
              () => commandBooks.setStarred(bookId, starred),
              undefined,
              false,
            ),
          ),
          remove: restricted.command((bookId) =>
            scopedCommand(bookId, "library.commands.books.remove", () => commandBooks.remove(bookId), undefined, false),
          ),
          removeMany: restricted.deny,
          retryRemovalCleanup: restricted.deny,
          addVirtualBook: restricted.deny,
          removeVirtualBook: restricted.deny,
          invalidateVirtualBook: restricted.deny,
        },
        collections: {
          create: restricted.deny,
          rename: restricted.deny,
          remove: restricted.deny,
          assignBooks: restricted.deny,
        },
      };
    };
    ctx.domains.library = restrictSurface<PluginLibraryDomain>(lifecycle, "domains.library", {
      queries: {
        books: {
          list: restricted.read(async () => {
            const operation = "library.books.list";
            lifecycle.assertActive(operation);
            const fence =
              grantedBookAccess.mode === "book"
                ? await objectAccess.beginBook(grantedBookAccess.bookId, operation)
                : await objectAccess.beginCurrent(operation);
            try {
              const books = await lifecycle.read(operation, () => queryBooks.list(), fence.signal);
              const result = objectAccess.filterBooks(books, currentBook());
              await fence.assertUnchanged();
              return result;
            } catch (error) {
              fence.dispose();
              throw error;
            }
          }),
          // Supported import formats describe the host, not a library object.
          listFormats: restricted.read(() =>
            lifecycle.read("library.books.listFormats", () => queryBooks.listFormats()),
          ),
          inspectResource: restricted.deny,
          listDuplicates: restricted.deny,
          previewMerge: restricted.deny,
          resolveId: restricted.deny,
          listRemovalCleanup: restricted.deny,
          get: restricted.read((bookId) =>
            scopedRead(
              bookId,
              "library.books.get",
              () => queryBooks.get(bookId),
              undefined,
              verifyBook("library.books.get"),
            ),
          ),
          getToc: restricted.read((bookId) =>
            scopedRead(bookId, "library.books.getToc", () => queryBooks.getToc(bookId)),
          ),
          getTextState: restricted.read((bookId) =>
            scopedRead(
              bookId,
              "library.books.getTextState",
              () => queryBooks.getTextState(bookId),
              undefined,
              verifyBookId("library.books.getTextState"),
            ),
          ),
          getEnrichment: restricted.read((bookId) =>
            scopedRead(
              bookId,
              "library.books.getEnrichment",
              () => queryBooks.getEnrichment(bookId),
              undefined,
              verifyBookId("library.books.getEnrichment"),
            ),
          ),
          getContentState: restricted.read((bookId, options) =>
            scopedRead(
              bookId,
              "library.books.getContentState",
              (signal) => queryBooks.getContentState(bookId, signal),
              options,
              verifyBookId("library.books.getContentState"),
            ),
          ),
          listTextTaskHistory: restricted.read((bookId, query) =>
            scopedRead(
              bookId,
              "library.books.listTextTaskHistory",
              () => queryBooks.listTextTaskHistory(bookId, query),
              undefined,
              (page) => {
                for (const item of page.items)
                  objectAccess.assertReturnedBook(item.snapshot.bookId, "library.books.listTextTaskHistory");
              },
            ),
          ),
          getTextTask: restricted.read((bookId, taskId) =>
            scopedRead(
              bookId,
              "library.books.getTextTask",
              () => queryBooks.getTextTask(bookId, taskId),
              undefined,
              verifyBookId("library.books.getTextTask"),
            ),
          ),
          listTextTasks: restricted.read((bookId) =>
            scopedRead(
              bookId,
              "library.books.listTextTasks",
              () => queryBooks.listTextTasks(bookId),
              undefined,
              (tasks) => {
                for (const task of tasks) objectAccess.assertReturnedBook(task.bookId, "library.books.listTextTasks");
              },
            ),
          ),
          getImportTask: restricted.deny,
          listImportTasks: restricted.deny,
          getChapterText: restricted.read((bookId, chapterIndex) =>
            scopedRead(bookId, "library.books.getChapterText", () => queryBooks.getChapterText(bookId, chapterIndex)),
          ),
          getNavigationToc: restricted.read((bookId, options) =>
            scopedRead(
              bookId,
              "library.books.getNavigationToc",
              (signal) => queryBooks.getNavigationToc(bookId, signal),
              options,
              verifyBookId("library.books.getNavigationToc"),
            ),
          ),
          listNavigationTargets: restricted.read((input, options) =>
            scopedRead(
              input.bookId,
              "library.books.listNavigationTargets",
              (signal) => queryBooks.listNavigationTargets(input, signal),
              options,
              verifyBookId("library.books.listNavigationTargets"),
            ),
          ),
          searchLocations: restricted.read((input, options) =>
            scopedRead(
              input.bookId,
              "library.books.searchLocations",
              (signal) => queryBooks.searchLocations(input, signal),
              options,
              verifyBookId("library.books.searchLocations"),
            ),
          ),
          readRange: restricted.read((input, options) =>
            scopedRead(
              input.range.bookId,
              "library.books.readRange",
              (signal) => queryBooks.readRange(input, signal),
              options,
              (value) => objectAccess.assertReturnedBook(value.range.bookId, "library.books.readRange"),
            ),
          ),
          listReferences: restricted.read((input, options) =>
            scopedRead(
              input.bookId,
              "library.books.listReferences",
              (signal) => queryBooks.listReferences(input, signal),
              options,
              verifyBookId("library.books.listReferences"),
            ),
          ),
          listImages: restricted.read((input, options) =>
            scopedRead(
              input.bookId,
              "library.books.listImages",
              (signal) => queryBooks.listImages(input, signal),
              options,
              verifyBookId("library.books.listImages"),
            ),
          ),
          openImageResource: restricted.read((input) =>
            scopedRead(
              input.image.bookId,
              "library.books.openImageResource",
              (signal) => openBookImageResource(resources, input, signal),
              undefined,
              (value) => objectAccess.assertReturnedBook(value.image.image.bookId, "library.books.openImageResource"),
            ),
          ),
          readReference: restricted.read((input, options) =>
            scopedRead(
              input.reference.bookId,
              "library.books.readReference",
              (signal) => queryBooks.readReference(input, signal),
              options,
              (value) => objectAccess.assertReturnedBook(value.reference.bookId, "library.books.readReference"),
            ),
          ),
          searchText: restricted.read((input, options) => {
            if (!input?.bookId) throw pluginObjectAccessDenied("library.books.searchText");
            return scopedRead(
              input.bookId,
              "library.books.searchText",
              (signal) => queryBooks.searchText(input, signal),
              options,
              (hits) => {
                for (const hit of hits) objectAccess.assertReturnedBook(hit.bookId, "library.books.searchText");
              },
            );
          }),
        },
        collections: {
          list: restricted.deny,
          booksIn: restricted.deny,
        },
      },
      events: {
        subscribe: restricted.deny,
        observeInvalidation: restricted.deny,
        observeImportTask: restricted.deny,
        observeTextTask: restricted.observe((bookId, taskId, listener) => {
          objectAccess.assertBook(bookId, "library.events.observeTextTask");
          return () => ({
            dispose: library.events.observeTextTask(bookId, taskId, (snapshot) => {
              try {
                objectAccess.assertBook(bookId, "library.events.observeTextTask");
                objectAccess.assertReturnedBook(snapshot.bookId, "library.events.observeTextTask");
                return listener(snapshot);
              } catch (error) {
                log.debug("library text task outside book grant", error);
              }
            }),
          });
        }),
        observeEnrichment: restricted.observe((bookId, listener) => {
          objectAccess.assertBook(bookId, "library.events.observeEnrichment");
          return () => ({
            dispose: library.events.observeEnrichment(bookId, (event) => {
              try {
                objectAccess.assertBook(bookId, "library.events.observeEnrichment");
                if (event.status === "ready")
                  objectAccess.assertReturnedBook(event.snapshot.bookId, "library.events.observeEnrichment");
                return listener(event);
              } catch (error) {
                log.debug("library enrichment outside book grant", error);
              }
            }),
          });
        }),
        observeContentState: restricted.observe((bookId, listener) => {
          objectAccess.assertBook(bookId, "library.events.observeContentState");
          return () => ({
            dispose: library.events.observeContentState(bookId, (event) => {
              try {
                objectAccess.assertBook(bookId, "library.events.observeContentState");
                if (event.status === "ready")
                  objectAccess.assertReturnedBook(event.snapshot.bookId, "library.events.observeContentState");
                return listener(event);
              } catch (error) {
                log.debug("library content state outside book grant", error);
              }
            }),
          });
        }),
      },
      commands: library.commands ? commandPolicy(library.commands) : restricted.absent,
    });
  }
}
