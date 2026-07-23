/**
 * Builds the `ctx` handed to a plugin's activate(). This is a POLICY shell:
 * the data surface itself is the shared domain layer (src/domain), built
 * here with origin `plugin:<id>`; this module adds what is plugin-specific —
 * manifest permission gating (docs/plugin-system.md §4), contribution
 * branding and disposal tracking, virtual-book bindings, and the service
 * capabilities. Gating is API-level — it prevents accidental overreach, not
 * malice; the trust boundary is installation itself (§2). Within a domain,
 * write implies read.
 */
import { getDefaultStore } from "jotai";
import type { DomainEventType } from "@read-aware/core";
import { DEFAULT_LOCALE, i18n, isAppLocale } from "../../../i18n";
import { onAppEvent } from "../../../platform/app-events";
import { exportTextFile } from "../../../platform/export-file";
import { localKV } from "../../../platform/local-store";
import { createDomainApi, type DomainEventSubscribe } from "../../../domain";
import { getAgentRuntime } from "../../ai/agent/agent-runtime";
import { createDictionaryPort } from "../../ai/agent/ports/dictionary-port";
import { openBookRequestAtom } from "../../ai/state/chat-intent";
import {
  getDictionaryLanguage,
  resolveExplanationLanguageName,
  saveDictionaryLanguage,
  type DictionaryLanguage,
} from "../../reader/lib/dictionary-prefs";
import {
  bindVirtualBook,
  findVirtualBookId,
  registerContentProviderContribution,
  unbindVirtualBook,
} from "../lib/virtual-books";
import { showPluginToast } from "../lib/plugin-toast";
import {
  contributionKey,
  type PluginContext,
  type PluginDisposable,
  type PluginManifest,
  type PluginSessionEventMap,
  type PluginSessionEventName,
} from "../lib/plugin-types";
import { requestPluginReaderNav } from "../state/reader-nav";
import {
  pluginDocsDelete,
  pluginDocsGet,
  pluginDocsList,
  pluginDocsPut,
  type PluginDocumentRow,
} from "./plugin-backend";
import {
  registerCommandContribution,
  registerHeaderActionContribution,
  registerSelectionActionContribution,
  registerToolContribution,
} from "../state/plugin-store";

function toPluginDocument(row: PluginDocumentRow) {
  let data: unknown = null;
  try {
    data = JSON.parse(row.json);
  } catch {
    data = null;
  }
  return {
    id: row.id,
    data,
    bookId: row.bookId ?? undefined,
    anchor: row.anchor ?? undefined,
    updatedAt: row.updatedAt,
  };
}

const SESSION_EVENTS: readonly PluginSessionEventName[] = [
  "book-opened",
  "book-closed",
  "chapter-changed",
  "reading-progress",
];

function requireDictionaryLanguage(value: unknown): DictionaryLanguage {
  if (value === "auto") return value;
  if (typeof value === "string" && isAppLocale(value)) return value;
  throw new Error(`Unsupported dictionary language: ${String(value)}`);
}

export function buildPluginContext(
  manifest: PluginManifest,
  appVersion: string,
  disposables: PluginDisposable[],
): PluginContext {
  const permissions = new Set(manifest.permissions ?? []);
  const domain = createDomainApi(`plugin:${manifest.id}`);
  const storagePrefix = `read-aware-plugin.${manifest.id}.`;
  const track = (disposable: PluginDisposable): PluginDisposable => {
    disposables.push(disposable);
    return disposable;
  };
  const brand = { pluginId: manifest.id, pluginName: manifest.name };

  /** Domain `on` returns a bare unsubscribe; plugins get a tracked disposable. */
  const trackedOn = <E extends DomainEventType>(on: DomainEventSubscribe<E>) =>
    ((event: never, handler: never) => track({ dispose: on(event, handler) })) as never;

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
      collection: (name) => {
        const collection = String(name);
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(collection)) {
          throw new Error(`invalid collection name: ${collection}`);
        }
        return {
          put: (id, data, options) =>
            pluginDocsPut(manifest.id, collection, String(id), JSON.stringify(data ?? null), {
              bookId: options?.bookId,
              anchor: options?.anchor,
            }),
          get: async (id) => {
            const row = await pluginDocsGet(manifest.id, collection, String(id));
            return (row ? toPluginDocument(row) : null) as never;
          },
          delete: (id) => pluginDocsDelete(manifest.id, collection, String(id)),
          list: async (filter) =>
            (
              await pluginDocsList(manifest.id, collection, {
                bookId: filter?.bookId,
                limit: filter?.limit,
                oldestFirst: filter?.oldestFirst,
              })
            ).map(toPluginDocument) as never,
        };
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
      exportFile: (file) => {
        if (!file || typeof file.filename !== "string" || typeof file.content !== "string") {
          throw new Error("exportFile requires a filename and text content");
        }
        return exportTextFile({
          filename: file.filename,
          content: file.content,
          mimeType: typeof file.mimeType === "string" ? file.mimeType : undefined,
        });
      },
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
    ctx.books = {
      list: domain.books.list,
      get: domain.books.get,
      getToc: domain.books.getToc,
      getChapterText: domain.books.getChapterText,
      on: trackedOn(domain.books.on),
    };
    if (permissions.has("books:write")) {
      ctx.books.write = {
        import: domain.books.importBook,
        editMetadata: domain.books.editMetadata,
        setStarred: domain.books.setStarred,
        remove: domain.books.remove,
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
            const alive = await domain.books.get(existingId);
            if (alive) {
              await domain.books.updateVirtualBookTitle(
                existingId,
                String(input.title),
                input.author,
              );
              return {
                ...alive,
                title: String(input.title),
                author: input.author ?? alive.author,
              };
            }
            unbindVirtualBook(existingId);
          }
          const book = await domain.books.addVirtualBook({
            title: String(input.title),
            author: input.author,
          });
          bindVirtualBook(book.id, binding);
          return book;
        },
        removeVirtualBook: async (input) => {
          const bookId = findVirtualBookId({
            pluginId: manifest.id,
            providerId: String(input.providerId),
            key: String(input.key),
          });
          if (!bookId) return;
          try {
            await domain.books.remove(bookId);
          } catch (error) {
            console.error("[plugins] virtual book removal", error);
          }
          unbindVirtualBook(bookId);
        },
      };
    }
  }

  // ─── Collections ──────────────────────────────────────────────────────────

  if (permissions.has("collections:read") || permissions.has("collections:write")) {
    ctx.collections = {
      list: domain.collections.list,
      booksIn: domain.collections.booksIn,
      on: trackedOn(domain.collections.on),
    };
    if (permissions.has("collections:write")) {
      ctx.collections.write = {
        create: domain.collections.create,
        rename: domain.collections.rename,
        remove: domain.collections.remove,
        assignBooks: domain.collections.assignBooks,
      };
    }
  }

  // ─── Annotations ──────────────────────────────────────────────────────────

  if (permissions.has("annotations:read") || permissions.has("annotations:write")) {
    ctx.annotations = {
      list: domain.annotations.list,
      on: trackedOn(domain.annotations.on),
    };
    if (permissions.has("annotations:write")) {
      ctx.annotations.write = {
        createHighlight: domain.annotations.createHighlight,
        recolorHighlight: domain.annotations.recolorHighlight,
        removeHighlight: domain.annotations.removeHighlight,
        createNote: domain.annotations.createNote,
        updateNote: domain.annotations.updateNote,
        removeNote: domain.annotations.removeNote,
      };
    }
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  if (permissions.has("reading:read")) {
    ctx.reading = {
      getState: domain.reading.getState,
      listStates: domain.reading.listStates,
      getTime: domain.reading.getTime,
      on: trackedOn(domain.reading.on),
    };
  }

  // ─── Conversations ────────────────────────────────────────────────────────

  if (permissions.has("conversations:read")) {
    ctx.conversations = {
      getBookThread: domain.conversations.getBookThread,
      listThreads: domain.conversations.listThreads,
      getThread: domain.conversations.getThread,
      on: trackedOn(domain.conversations.on),
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
      lookUp: async ({ term, context, bookTitle, language }) => {
        const selectedLanguage =
          language == null ? undefined : requireDictionaryLanguage(language);
        const locale =
          i18n.language && isAppLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
        const result = await dictionary.lookUp({
          term: String(term),
          context: context == null ? undefined : String(context),
          bookTitle: bookTitle == null ? undefined : String(bookTitle),
          explanationLanguage:
            selectedLanguage == null
              ? undefined
              : resolveExplanationLanguageName(selectedLanguage, locale),
        });
        return { language: result.language, entry: result.entry };
      },
      getLanguage: getDictionaryLanguage,
      setLanguage: (language) => saveDictionaryLanguage(requireDictionaryLanguage(language)),
    };
  }

  if (permissions.has("service:clipboard")) {
    ctx.clipboard = {
      writeText: (text) => navigator.clipboard.writeText(String(text)),
    };
  }

  return ctx;
}
