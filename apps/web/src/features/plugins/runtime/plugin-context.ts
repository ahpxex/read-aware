/**
 * Builds the `ctx` handed to a plugin's activate(): the whole API surface,
 * derived from the domain model (docs/plugin-system.md §4–§6). Each data
 * domain exposes reads over its projections, writes that issue the domain's
 * own event verbs through the app's dual-write seams (stamped with this
 * plugin's origin), and subscriptions to its canonical domain events.
 *
 * Gating is API-level — capability groups are absent unless the manifest
 * declares the permission; it prevents accidental overreach, not malice; the
 * trust boundary is installation itself (§2). Within a domain, write implies
 * read.
 */
import { getDefaultStore } from "jotai";
import type { DomainEventType, EventOrigin } from "@read-aware/core";
import { i18n } from "../../../i18n";
import { emitAppEvent, onAppEvent } from "../../../platform/app-events";
import {
  onDomainEventBroadcast,
  type DomainEventBroadcast,
} from "../../../platform/domain-events";
import { localKV } from "../../../platform/local-store";
import { getAgentRuntime } from "../../ai/agent/agent-runtime";
import { createBookTextPort } from "../../ai/agent/ports/book-text-port";
import { createDictionaryPort } from "../../ai/agent/ports/dictionary-port";
import { loadConversation, listGlobalThreads } from "../../ai/lib/conversation-store";
import { openBookRequestAtom } from "../../ai/state/chat-intent";
import {
  createHighlight,
  createNote,
  deleteAnnotation,
  getAnnotation,
  listAnnotations,
  recolorHighlight,
  updateNote,
} from "../../annotations/lib/annotation-db";
import type { Annotation } from "../../annotations/lib/annotation-types";
import { annotationsRevisionAtom } from "../../annotations/state/annotations-revision";
import {
  addVirtualLibraryBook,
  commitBookImport,
  createCollection,
  deleteCollection,
  listCollections,
  listLibraryBooks,
  prepareBookImport,
  removeLibraryBook,
  renameCollection,
  setBooksCollection,
  setLibraryBookStarred,
  updateBookMetadata,
  updateVirtualLibraryBookTitle,
} from "../../library/lib/library-db";
import type { LibraryBook } from "../../library/lib/library-types";
import {
  getBookReadingStats,
  getReadingStatsStore,
} from "../../reader/lib/reading-stats";
import {
  addToVocabulary,
  getVocabulary,
  removeFromVocabulary,
} from "../../reader/lib/vocabulary";
import {
  bindVirtualBook,
  findVirtualBookId,
  registerContentProviderContribution,
  unbindVirtualBook,
} from "../lib/virtual-books";
import { showPluginToast } from "../lib/plugin-toast";
import {
  contributionKey,
  type PluginAnnotation,
  type PluginBook,
  type PluginContext,
  type PluginDisposable,
  type PluginDomainEvent,
  type PluginManifest,
  type PluginReadingState,
  type PluginSessionEventMap,
  type PluginSessionEventName,
} from "../lib/plugin-types";
import { requestPluginReaderNav } from "../state/reader-nav";
import {
  registerCommandContribution,
  registerHeaderActionContribution,
  registerSelectionActionContribution,
  registerToolContribution,
} from "../state/plugin-store";

// ─── Domain event rosters (which canonical names each namespace serves) ──────

const BOOK_EVENTS = [
  "book.imported",
  "book.metadataEdited",
  "book.coverExtracted",
  "book.opened",
  "book.starred",
  "book.removed",
] as const;

const COLLECTION_EVENTS = [
  "collection.created",
  "collection.renamed",
  "collection.removed",
  "book.addedToCollection",
  "book.removedFromCollection",
] as const;

const ANNOTATION_EVENTS = [
  "highlight.created",
  "highlight.recolored",
  "highlight.removed",
  "note.created",
  "note.updated",
  "note.removed",
  "ask.recorded",
  "ask.removed",
] as const;

const READING_EVENTS = ["reading.progressed", "reading.timeRecorded"] as const;

const VOCABULARY_EVENTS = ["vocabulary.added", "vocabulary.removed"] as const;

const SESSION_EVENTS: readonly PluginSessionEventName[] = [
  "book-opened",
  "book-closed",
  "chapter-changed",
  "reading-progress",
];

// ─── Read-model mappers (projection rows → plugin shapes) ────────────────────

function toPluginBook(book: LibraryBook): PluginBook {
  return {
    id: book.id,
    title: book.title,
    author: book.author || undefined,
    format: book.format,
    starred: book.starred === true,
    collectionId: book.collectionId ?? null,
    addedAt: book.createdAt,
    updatedAt: book.updatedAt,
    lastOpenedAt: book.lastOpenedAt ?? undefined,
    fileName: book.fileName || undefined,
    fileSize: book.fileSize || undefined,
  };
}

function toPluginReadingState(book: LibraryBook): PluginReadingState {
  return {
    bookId: book.id,
    progressPercent: book.progressPercent ?? 0,
    status: book.readingStatus,
    locator: book.progress?.cfi ?? book.progress?.href ?? undefined,
    chapterHref: book.progress?.href ?? undefined,
    currentLocation: book.progress?.currentLocation,
    totalLocations: book.progress?.totalLocations,
  };
}

function toPluginAnnotation(annotation: Annotation): PluginAnnotation {
  const anchor = annotation.cfiRange ?? undefined;
  const chapterHref = annotation.chapterHref ?? undefined;
  if (annotation.type === "highlight") {
    return {
      kind: "highlight",
      id: annotation.id,
      bookId: annotation.bookId,
      text: annotation.text,
      anchor,
      chapterHref,
      color: annotation.color ?? "yellow",
      style: annotation.style ?? "highlight",
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
    };
  }
  if (annotation.type === "note") {
    return {
      kind: "note",
      id: annotation.id,
      bookId: annotation.bookId,
      quotedText: annotation.text || undefined,
      body: annotation.content ?? "",
      anchor,
      chapterHref,
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
    };
  }
  return {
    kind: "ask",
    id: annotation.id,
    bookId: annotation.bookId,
    text: annotation.text,
    anchor,
    chapterHref,
    createdAt: annotation.createdAt,
  };
}

export function buildPluginContext(
  manifest: PluginManifest,
  appVersion: string,
  disposables: PluginDisposable[],
): PluginContext {
  const permissions = new Set(manifest.permissions ?? []);
  const origin: EventOrigin = `plugin:${manifest.id}`;
  const storagePrefix = `read-aware-plugin.${manifest.id}.`;
  const track = (disposable: PluginDisposable): PluginDisposable => {
    disposables.push(disposable);
    return disposable;
  };
  const brand = { pluginId: manifest.id, pluginName: manifest.name };

  /** Reader/context annotation lists re-read on this revision counter. */
  const bumpAnnotationsRevision = (): void => {
    const store = getDefaultStore();
    store.set(annotationsRevisionAtom, store.get(annotationsRevisionAtom) + 1);
  };

  /** Shelf and library surfaces reload on this app event. */
  const notifyLibraryChanged = (): void => emitAppEvent("library-changed", {});

  /**
   * A namespace's `on`: canonical domain events off the in-app broadcast,
   * restricted to the namespace's roster, handler failures isolated.
   */
  const domainSubscribe = (roster: readonly DomainEventType[]) =>
    ((event: DomainEventType, handler: (event: PluginDomainEvent) => void) => {
      if (!roster.includes(event)) {
        throw new Error(`"${event}" is not an event of this domain`);
      }
      const off = onDomainEventBroadcast((broadcast: DomainEventBroadcast) => {
        if (broadcast.type !== event) return;
        try {
          handler(broadcast);
        } catch (error) {
          console.error(`[plugins] event handler from "${manifest.id}" failed`, error);
        }
      });
      return track({ dispose: off });
    }) as never;

  const getBookRecord = async (bookId: string): Promise<LibraryBook | null> =>
    (await listLibraryBooks()).find((book) => book.id === String(bookId)) ?? null;

  const ctx: PluginContext = {
    manifest,
    appVersion,
    storage: {
      get: (key) => {
        const raw = localKV.getItem(storagePrefix + key);
        if (raw == null) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      },
      set: (key, value) => {
        localKV.setItem(storagePrefix + key, JSON.stringify(value ?? null));
      },
      remove: (key) => {
        localKV.removeItem(storagePrefix + key);
      },
    },
    ui: {
      registerSelectionAction: (action) =>
        track(
          registerSelectionActionContribution({
            ...action,
            ...brand,
            key: contributionKey(manifest.id, action.id),
          }),
        ),
      registerHeaderAction: (action) =>
        track(
          registerHeaderActionContribution({
            ...action,
            ...brand,
            // The reader never allows full-page interruptions (§5).
            presentation:
              action.surface === "reader" ? "popup" : (action.presentation ?? "popup"),
            key: contributionKey(manifest.id, action.id),
          }),
        ),
      registerCommand: (command) =>
        track(
          registerCommandContribution({
            ...command,
            ...brand,
            key: contributionKey(manifest.id, command.id),
          }),
        ),
      showToast: (message) => showPluginToast(String(message)),
    },
    reader: {
      openBook: (bookId) => {
        getDefaultStore().set(openBookRequestAtom, {
          id: crypto.randomUUID(),
          bookId: String(bookId),
        });
      },
      goTo: (target) => {
        requestPluginReaderNav({
          bookId: target.bookId ? String(target.bookId) : undefined,
          cfi: target.cfi ? String(target.cfi) : undefined,
          href: target.href ? String(target.href) : undefined,
        });
      },
    },
    session: {
      on: (event, handler) => {
        if (!SESSION_EVENTS.includes(event)) {
          throw new Error(`"${String(event)}" is not a session event`);
        }
        const off = onAppEvent(event, ((payload: PluginSessionEventMap[typeof event]) => {
          try {
            handler(payload as never);
          } catch (error) {
            console.error(`[plugins] event handler from "${manifest.id}" failed`, error);
          }
        }) as never);
        return track({ dispose: off });
      },
    },
  };

  // ─── Books ────────────────────────────────────────────────────────────────

  if (permissions.has("books:read") || permissions.has("books:write")) {
    const bookText = createBookTextPort();
    ctx.books = {
      list: async () => (await listLibraryBooks()).map(toPluginBook),
      get: async (bookId) => {
        const book = await getBookRecord(bookId);
        return book ? toPluginBook(book) : null;
      },
      getToc: async (bookId) =>
        (await bookText.getToc(bookId)).map((chapter) => ({
          index: chapter.index,
          title: chapter.title,
          chars: chapter.chars,
        })),
      getChapterText: async (bookId, chapterIndex) =>
        (await bookText.getChapterText(bookId, Number(chapterIndex))) ?? null,
      on: domainSubscribe(BOOK_EVENTS),
    };
    if (permissions.has("books:write")) {
      ctx.books.write = {
        import: async (input) => {
          const file = new File([input.data], String(input.fileName));
          const t = i18n.getFixedT(null, "shelf");
          const existing = await listLibraryBooks();
          const result = await prepareBookImport({ kind: "file", file }, t, existing);
          if (result.status === "prepared") {
            await commitBookImport(result.book, { kind: "file", file }, origin);
            notifyLibraryChanged();
          }
          return toPluginBook(result.book);
        },
        editMetadata: async (bookId, patch) => {
          await updateBookMetadata(
            String(bookId),
            { title: patch.title, author: patch.author },
            origin,
          );
          notifyLibraryChanged();
        },
        setStarred: async (bookId, starred) => {
          await setLibraryBookStarred(String(bookId), starred === true, origin);
          notifyLibraryChanged();
        },
        remove: async (bookId) => {
          await removeLibraryBook(String(bookId), origin);
          notifyLibraryChanged();
        },
        registerContentProvider: (provider) =>
          track(
            registerContentProviderContribution({
              key: `${manifest.id}:${provider.id}`,
              pluginId: manifest.id,
              providerId: String(provider.id),
              load: (bookKey: string) => Promise.resolve(provider.load(bookKey)),
            }),
          ),
        addVirtualBook: async (input) => {
          const binding = {
            pluginId: manifest.id,
            providerId: String(input.providerId),
            key: String(input.key),
          };
          const existingId = findVirtualBookId(binding);
          if (existingId) {
            // The binding may be an orphan (book deleted before cleanup
            // existed, or through an untracked path) — verify the record.
            const alive = await getBookRecord(existingId);
            if (alive) {
              await updateVirtualLibraryBookTitle(existingId, String(input.title), input.author);
              notifyLibraryChanged();
              return toPluginBook({
                ...alive,
                title: String(input.title),
                author: input.author ?? alive.author,
              });
            }
            unbindVirtualBook(existingId);
          }
          const book = await addVirtualLibraryBook({
            title: String(input.title),
            author: input.author,
          });
          bindVirtualBook(book.id, binding);
          notifyLibraryChanged();
          return toPluginBook(book);
        },
        removeVirtualBook: async (input) => {
          const bookId = findVirtualBookId({
            pluginId: manifest.id,
            providerId: String(input.providerId),
            key: String(input.key),
          });
          if (!bookId) return;
          try {
            await removeLibraryBook(bookId, origin);
          } catch (error) {
            console.error("[plugins] virtual book removal", error);
          }
          unbindVirtualBook(bookId);
          notifyLibraryChanged();
        },
      };
    }
  }

  // ─── Collections ──────────────────────────────────────────────────────────

  if (permissions.has("collections:read") || permissions.has("collections:write")) {
    ctx.collections = {
      list: async () =>
        (await listCollections()).map((collection) => ({
          id: collection.id,
          name: collection.name,
          createdAt: collection.createdAt,
        })),
      booksIn: async (collectionId) =>
        (await listLibraryBooks())
          .filter((book) => book.collectionId === String(collectionId))
          .map((book) => book.id),
      on: domainSubscribe(COLLECTION_EVENTS),
    };
    if (permissions.has("collections:write")) {
      ctx.collections.write = {
        create: async (name) => {
          const collection = await createCollection(String(name), origin);
          notifyLibraryChanged();
          return { id: collection.id, name: collection.name, createdAt: collection.createdAt };
        },
        rename: async (collectionId, name) => {
          await renameCollection(String(collectionId), String(name), origin);
          notifyLibraryChanged();
        },
        remove: async (collectionId) => {
          await deleteCollection(String(collectionId), origin);
          notifyLibraryChanged();
        },
        assignBooks: async (bookIds, collectionId) => {
          await setBooksCollection(
            bookIds.map(String),
            collectionId == null ? null : String(collectionId),
            origin,
          );
          notifyLibraryChanged();
        },
      };
    }
  }

  // ─── Annotations ──────────────────────────────────────────────────────────

  if (permissions.has("annotations:read") || permissions.has("annotations:write")) {
    ctx.annotations = {
      list: async (filter) =>
        (
          await listAnnotations({
            bookId: filter?.bookId ? String(filter.bookId) : undefined,
            type: filter?.kind,
            searchQuery: filter?.query,
          })
        ).map(toPluginAnnotation),
      on: domainSubscribe(ANNOTATION_EVENTS),
    };
    if (permissions.has("annotations:write")) {
      const requireHighlight = async (id: string) => {
        const existing = await getAnnotation(String(id));
        if (!existing || existing.type !== "highlight") {
          throw new Error(`highlight not found: ${id}`);
        }
        return existing;
      };
      const requireNote = async (id: string) => {
        const existing = await getAnnotation(String(id));
        if (!existing || existing.type !== "note") {
          throw new Error(`note not found: ${id}`);
        }
        return existing;
      };
      ctx.annotations.write = {
        createHighlight: async (input) => {
          const highlight = await createHighlight(
            String(input.bookId),
            input.anchor ?? null,
            input.chapterHref ?? null,
            String(input.text),
            input.color ?? "yellow",
            input.style ?? "highlight",
            origin,
          );
          bumpAnnotationsRevision();
          return toPluginAnnotation(highlight) as never;
        },
        recolorHighlight: async (highlightId, color) => {
          const existing = await requireHighlight(highlightId);
          await recolorHighlight(existing, color, origin);
          bumpAnnotationsRevision();
        },
        removeHighlight: async (highlightId) => {
          await requireHighlight(highlightId);
          await deleteAnnotation(String(highlightId), origin);
          bumpAnnotationsRevision();
        },
        createNote: async (input) => {
          const note = await createNote(
            String(input.bookId),
            input.anchor ?? null,
            input.chapterHref ?? null,
            String(input.quotedText ?? ""),
            String(input.body),
            origin,
          );
          bumpAnnotationsRevision();
          return toPluginAnnotation(note) as never;
        },
        updateNote: async (noteId, body) => {
          await requireNote(noteId);
          await updateNote(String(noteId), String(body), origin);
          bumpAnnotationsRevision();
        },
        removeNote: async (noteId) => {
          await requireNote(noteId);
          await deleteAnnotation(String(noteId), origin);
          bumpAnnotationsRevision();
        },
      };
    }
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  if (permissions.has("reading:read")) {
    ctx.reading = {
      getState: async (bookId) => {
        const book = await getBookRecord(bookId);
        return book ? toPluginReadingState(book) : null;
      },
      listStates: async () => (await listLibraryBooks()).map(toPluginReadingState),
      getTime: async (bookId) => {
        const store = getReadingStatsStore();
        if (!store[String(bookId)]) return null;
        const stats = getBookReadingStats(store, String(bookId));
        return {
          bookId: stats.bookId,
          totalMs: stats.totalMs,
          firstReadAt:
            stats.firstStartedAt != null
              ? new Date(stats.firstStartedAt).toISOString()
              : undefined,
          lastReadAt:
            stats.lastReadAt != null ? new Date(stats.lastReadAt).toISOString() : undefined,
          daily: { ...stats.daily },
        };
      },
      on: domainSubscribe(READING_EVENTS),
    };
  }

  // ─── Vocabulary ───────────────────────────────────────────────────────────

  if (permissions.has("vocabulary:read") || permissions.has("vocabulary:write")) {
    ctx.vocabulary = {
      list: async (filter) => {
        const needle = filter?.query?.trim().toLowerCase();
        const items = [...getVocabulary()]
          .sort((a, b) => b.addedAt - a.addedAt)
          .filter((item) => !needle || item.term.toLowerCase().includes(needle))
          .map((item) => ({
            term: item.term,
            language: item.language,
            definition: item.entry.senses[0]?.definition ?? item.entry.contextualMeaning ?? "",
            entry: item.entry,
            context: item.context,
            bookId: item.bookId,
            bookTitle: item.bookTitle,
            addedAt: new Date(item.addedAt).toISOString(),
          }));
        return typeof filter?.limit === "number" ? items.slice(0, filter.limit) : items;
      },
      on: domainSubscribe(VOCABULARY_EVENTS),
    };
    if (permissions.has("vocabulary:write")) {
      ctx.vocabulary.write = {
        add: async (input) => {
          addToVocabulary(
            {
              term: String(input.term),
              language: String(input.language),
              entry: input.entry,
              context: input.context,
              bookId: input.bookId,
              bookTitle: input.bookTitle,
            },
            origin,
          );
        },
        remove: async (term, language) => {
          removeFromVocabulary(String(term), String(language), origin);
        },
      };
    }
  }

  // ─── Conversations ────────────────────────────────────────────────────────

  if (permissions.has("conversations:read")) {
    const toMessages = (messages: Awaited<ReturnType<typeof loadConversation>>) =>
      messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        }));
    ctx.conversations = {
      // The in-book thread is keyed by the book id (one thread per book).
      getBookThread: async (bookId) => toMessages(await loadConversation(String(bookId))),
      listThreads: async () =>
        (await listGlobalThreads()).map((thread) => ({
          id: thread.id,
          title: thread.preview,
          updatedAt: thread.updatedAt,
        })),
      getThread: async (threadId) => toMessages(await loadConversation(String(threadId))),
    };
  }

  // ─── Agent tools ──────────────────────────────────────────────────────────

  if (permissions.has("agent:tools")) {
    ctx.agent = {
      registerTool: (tool) =>
        track(
          registerToolContribution({
            ...tool,
            ...brand,
            key: contributionKey(manifest.id, tool.name),
          }),
        ),
    };
  }

  // ─── Services ─────────────────────────────────────────────────────────────

  if (permissions.has("service:network")) {
    ctx.network = {
      fetch: (input, init) => globalThis.fetch(input, init),
    };
  }

  if (permissions.has("service:llm")) {
    ctx.llm = {
      ask: async (input) => {
        const runtime = getAgentRuntime();
        if (!runtime) throw new Error("AI is not configured");
        return runtime.ask({
          prompt: String(input.prompt),
          system: input.system,
          model: input.model === "smart" ? "smart" : "fast",
        });
      },
    };
  }

  if (permissions.has("service:dictionary")) {
    const dictionary = createDictionaryPort();
    ctx.dictionary = {
      lookUp: async ({ term, context, bookTitle }) => {
        const result = await dictionary.lookUp({ term: String(term), context, bookTitle });
        return { language: result.language, entry: result.entry };
      },
    };
  }

  if (permissions.has("service:clipboard")) {
    ctx.clipboard = {
      writeText: (text) => navigator.clipboard.writeText(String(text)),
    };
  }

  return ctx;
}
