/**
 * Builds the `ctx` handed to a plugin's activate(): the whole API surface,
 * with permission-gated capability groups (docs/plugin-system.md §4). Gating
 * here is API-level — it prevents accidental overreach, not malice; the trust
 * boundary is installation itself (§2).
 */
import { getDefaultStore } from "jotai";
import { i18n } from "../../../i18n";
import { emitAppEvent, onAppEvent } from "../../../platform/app-events";
import { localKV } from "../../../platform/local-store";
import { getAgentRuntime } from "../../ai/agent/agent-runtime";
import { createAnnotationsPort } from "../../ai/agent/ports/annotations-port";
import { createBookTextPort } from "../../ai/agent/ports/book-text-port";
import { createDictionaryPort } from "../../ai/agent/ports/dictionary-port";
import { createLibraryPort } from "../../ai/agent/ports/library-port";
import { openBookRequestAtom } from "../../ai/state/chat-intent";
import {
  addVirtualLibraryBook,
  commitBookImport,
  listLibraryBooks,
  prepareBookImport,
  removeLibraryBook,
  updateVirtualLibraryBookTitle,
} from "../../library/lib/library-db";
import {
  bindVirtualBook,
  findVirtualBookId,
  registerContentProviderContribution,
  unbindVirtualBook,
} from "../lib/virtual-books";
import { requestPluginReaderNav } from "../state/reader-nav";
import {
  createHighlight,
  createNote,
  deleteAnnotation,
  getAnnotation,
  recolorHighlight,
  updateNote,
} from "../../annotations/lib/annotation-db";
import { annotationsRevisionAtom } from "../../annotations/state/annotations-revision";
import {
  addToVocabulary,
  getVocabulary,
  removeFromVocabulary,
} from "../../reader/lib/vocabulary";

/** Reader/context annotation lists re-read on this revision counter. */
function bumpAnnotationsRevision(): void {
  const store = getDefaultStore();
  store.set(annotationsRevisionAtom, store.get(annotationsRevisionAtom) + 1);
}
import { showPluginToast } from "../lib/plugin-toast";
import {
  contributionKey,
  type PluginContext,
  type PluginDisposable,
  type PluginManifest,
} from "../lib/plugin-types";
import {
  registerCommandContribution,
  registerHeaderActionContribution,
  registerSelectionActionContribution,
  registerToolContribution,
} from "../state/plugin-store";

export function buildPluginContext(
  manifest: PluginManifest,
  appVersion: string,
  disposables: PluginDisposable[],
): PluginContext {
  const permissions = new Set(manifest.permissions ?? []);
  const storagePrefix = `read-aware-plugin.${manifest.id}.`;
  const track = (disposable: PluginDisposable): PluginDisposable => {
    disposables.push(disposable);
    return disposable;
  };
  const brand = { pluginId: manifest.id, pluginName: manifest.name };

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
    events: {
      on: (event, handler) => {
        if (event.startsWith("annotation") && !permissions.has("reading-data")) {
          throw new Error(`subscribing to "${event}" requires the reading-data permission`);
        }
        const off = onAppEvent(event as never, ((payload: unknown) => {
          try {
            if (event === "annotation-created") {
              const { annotation } = payload as {
                annotation: {
                  id: string;
                  bookId: string;
                  type: "highlight" | "note" | "ask";
                  text: string;
                  content?: string;
                  chapterHref: string | null;
                  createdAt: string;
                };
              };
              handler({
                annotation: {
                  id: annotation.id,
                  bookId: annotation.bookId,
                  kind: annotation.type,
                  text: annotation.text,
                  content: annotation.content,
                  chapter: annotation.chapterHref ?? undefined,
                  createdAt: annotation.createdAt,
                },
              } as never);
            } else {
              handler(payload as never);
            }
          } catch (error) {
            console.error(`[plugins] event handler from "${manifest.id}" failed`, error);
          }
        }) as never);
        return track({ dispose: off });
      },
    },
  };

  if (permissions.has("ai")) {
    ctx.ai = {
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

  if (permissions.has("network")) {
    ctx.fetch = (input, init) => globalThis.fetch(input, init);
  }

  if (permissions.has("reading-data")) {
    const library = createLibraryPort();
    const annotations = createAnnotationsPort();
    const bookText = createBookTextPort();
    ctx.reading = {
      createHighlight: async (input) => {
        const highlight = await createHighlight(
          String(input.bookId),
          input.cfiRange ?? null,
          input.chapterHref ?? null,
          String(input.text),
          input.color ?? "yellow",
          input.style ?? "highlight",
        );
        bumpAnnotationsRevision();
        return {
          id: highlight.id,
          bookId: highlight.bookId,
          kind: "highlight",
          text: highlight.text,
          chapter: highlight.chapterHref ?? undefined,
          createdAt: highlight.createdAt,
        };
      },
      createNote: async (input) => {
        const note = await createNote(
          String(input.bookId),
          input.cfiRange ?? null,
          input.chapterHref ?? null,
          String(input.text),
          String(input.content),
        );
        bumpAnnotationsRevision();
        return {
          id: note.id,
          bookId: note.bookId,
          kind: "note",
          text: note.text,
          content: note.content,
          chapter: note.chapterHref ?? undefined,
          createdAt: note.createdAt,
        };
      },
      deleteAnnotation: async (id) => {
        await deleteAnnotation(String(id));
        bumpAnnotationsRevision();
      },
      updateNote: async (id, content) => {
        await updateNote(String(id), String(content));
        bumpAnnotationsRevision();
      },
      recolorHighlight: async (id, color) => {
        const existing = await getAnnotation(String(id));
        if (!existing || existing.type !== "highlight") {
          throw new Error(`highlight not found: ${id}`);
        }
        await recolorHighlight(existing, color);
        bumpAnnotationsRevision();
      },
      getToc: async (bookId) =>
        (await bookText.getToc(bookId)).map((chapter) => ({
          index: chapter.index,
          title: chapter.title,
          chars: chapter.chars,
        })),
      getChapterText: async (bookId, chapterIndex) =>
        (await bookText.getChapterText(bookId, Number(chapterIndex))) ?? null,
      vocabulary: {
        list: async (filter) => {
          const needle = filter?.query?.trim().toLowerCase();
          const items = [...getVocabulary()]
            .sort((a, b) => b.addedAt - a.addedAt)
            .filter((item) => !needle || item.term.toLowerCase().includes(needle))
            .map((item) => ({
              term: item.term,
              language: item.language,
              definition: item.entry.senses[0]?.definition ?? item.entry.contextualMeaning ?? "",
              bookTitle: item.bookTitle,
              context: item.context,
              addedAt: new Date(item.addedAt).toISOString(),
              entry: item.entry,
            }));
          return typeof filter?.limit === "number" ? items.slice(0, filter.limit) : items;
        },
        add: async (input) => {
          addToVocabulary({
            term: String(input.term),
            language: String(input.language),
            entry: input.entry,
            context: input.context,
            bookTitle: input.bookTitle,
          });
        },
        remove: async (term, language) => {
          removeFromVocabulary(String(term), String(language));
        },
      },
      listBooks: async () =>
        (await library.listBooks()).map((book) => ({
          id: String(book.id),
          title: book.title,
          author: book.author,
          progressFraction: book.progressFraction,
          addedAt: book.addedAt,
          lastOpenedAt: book.lastOpenedAt,
        })),
      listAnnotations: async (filter) =>
        (
          await annotations.listAnnotations(
            filter?.bookId ? { bookId: filter.bookId } : undefined,
          )
        ).map((annotation) => ({
          id: annotation.id,
          bookId: String(annotation.bookId),
          kind: annotation.kind,
          text: annotation.text,
          content: annotation.content,
          chapter: annotation.chapter,
          createdAt: annotation.createdAt,
        })),
    };
  }

  if (permissions.has("dictionary")) {
    const dictionary = createDictionaryPort();
    ctx.dictionary = {
      lookUp: async ({ term, context, bookTitle }) => {
        const result = await dictionary.lookUp({ term: String(term), context, bookTitle });
        return { language: result.language, entry: result.entry };
      },
    };
  }

  if (permissions.has("llm")) {
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

  if (permissions.has("library-write")) {
    ctx.library = {
      importBook: async (input) => {
        const file = new File([input.data], String(input.fileName));
        const t = i18n.getFixedT(null, "shelf");
        const existing = await listLibraryBooks();
        const result = await prepareBookImport({ kind: "file", file }, t, existing);
        const book = result.book;
        if (result.status === "prepared") {
          await commitBookImport(book, { kind: "file", file });
          emitAppEvent("library-changed", {});
        }
        return {
          id: book.id,
          title: book.title,
          author: book.author || undefined,
          progressFraction: (book.progressPercent ?? 0) / 100,
          addedAt: book.createdAt,
          lastOpenedAt: book.lastOpenedAt ?? undefined,
        };
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
          const alive = (await listLibraryBooks()).some((b) => b.id === existingId);
          if (alive) {
            await updateVirtualLibraryBookTitle(existingId, String(input.title), input.author);
            emitAppEvent("library-changed", {});
            return { id: existingId, title: String(input.title), author: input.author };
          }
          unbindVirtualBook(existingId);
        }
        const book = await addVirtualLibraryBook({
          title: String(input.title),
          author: input.author,
        });
        bindVirtualBook(book.id, binding);
        emitAppEvent("library-changed", {});
        return {
          id: book.id,
          title: book.title,
          author: book.author || undefined,
          progressFraction: 0,
          addedAt: book.createdAt,
        };
      },
      removeVirtualBook: async (input) => {
        const bookId = findVirtualBookId({
          pluginId: manifest.id,
          providerId: String(input.providerId),
          key: String(input.key),
        });
        if (!bookId) return;
        try {
          await removeLibraryBook(bookId);
        } catch (error) {
          console.error("[plugins] virtual book removal", error);
        }
        unbindVirtualBook(bookId);
        emitAppEvent("library-changed", {});
      },
    };
  }

  if (permissions.has("clipboard")) {
    ctx.clipboard = {
      writeText: (text) => navigator.clipboard.writeText(String(text)),
    };
  }

  return ctx;
}
