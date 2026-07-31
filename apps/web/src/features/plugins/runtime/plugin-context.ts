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
import { openBookRequestAtom } from "../../ai/state/chat-intent";
import {
  bindVirtualBook,
  findVirtualBookId,
  registerContentProviderContribution,
  unbindVirtualBook,
} from "../lib/virtual-books";
import { showPluginToast } from "../lib/plugin-toast";
import { normalizeReaderMode } from "../lib/reader-mode";
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
  registerReaderModeContribution,
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

/** The app UI's current locale, normalized to a supported one. */
export function currentAppLocale(): string {
  return i18n.language && isAppLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}

/** Sanitize a command's declared default shortcut; junk shapes become none. */
function normalizeDefaultShortcut(
  raw: unknown,
): { key: string; mod?: boolean; alt?: boolean; shift?: boolean } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as { key?: unknown; mod?: unknown; alt?: unknown; shift?: unknown };
  if (typeof candidate.key !== "string" || !candidate.key.trim()) return undefined;
  const key = candidate.key.length === 1 ? candidate.key.toLowerCase() : candidate.key;
  return {
    key,
    mod: candidate.mod === true || undefined,
    alt: candidate.alt === true || undefined,
    shift: candidate.shift === true || undefined,
  };
}

/**
 * KV namespace for a plugin. Exported so the sandbox host can ship the whole
 * namespace into the Worker at boot, keeping `storage.get()` synchronous there.
 */
export const pluginStoragePrefix = (pluginId: string) => `read-aware-plugin.${pluginId}.`;

export function buildPluginContext(
  manifest: PluginManifest,
  appVersion: string,
  disposables: PluginDisposable[],
): PluginContext {
  const permissions = new Set(manifest.permissions ?? []);
  const domain = createDomainApi(`plugin:${manifest.id}`);
  const storagePrefix = pluginStoragePrefix(manifest.id);
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
    // Live read — the worker mirrors this via the sync channel instead.
    get locale() {
      return currentAppLocale();
    },
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
            defaultShortcut: normalizeDefaultShortcut(command.defaultShortcut),
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
      modes: permissions.has("reader:modes")
        ? {
            register: (mode) => {
              const normalized = normalizeReaderMode(mode);
              return track(
                registerReaderModeContribution({
                  ...normalized,
                  ...brand,
                  key: contributionKey(manifest.id, normalized.id),
                }),
              );
            },
          }
        : undefined,
    },
    session: {
      on: (event, handler) => {
        if (!SESSION_EVENTS.includes(event)) {
          throw new Error(`"${String(event)}" is not a session event`);
        }
        const off = onAppEvent(event, ((payload: PluginSessionEventMap[typeof event]) => {
          const report = (error: unknown) =>
            console.error(`[plugins] event handler from "${manifest.id}" failed`, error);
          try {
            // Sandboxed handlers are async proxies; their failures reject.
            const result = handler(payload as never) as unknown;
            if (result instanceof Promise) result.catch(report);
          } catch (error) {
            report(error);
          }
        }) as never);
        return track({ dispose: off });
      },
    },
  };

  // ─── Shelf (books + collections + stats) ──────────────────────────────────

  if (permissions.has("shelf:read") || permissions.has("shelf:write")) {
    ctx.shelf = {
      books: {
        list: domain.shelf.books.list,
        get: domain.shelf.books.get,
        getToc: domain.shelf.books.getToc,
        getChapterText: domain.shelf.books.getChapterText,
      },
      collections: {
        list: domain.shelf.collections.list,
        booksIn: domain.shelf.collections.booksIn,
      },
      stats: {
        forBook: domain.shelf.stats.forBook,
        list: domain.shelf.stats.list,
        overview: domain.shelf.stats.overview,
      },
      on: trackedOn(domain.shelf.on),
    };
    if (permissions.has("shelf:write")) {
      ctx.shelf.books.write = {
        import: domain.shelf.books.importBook,
        editMetadata: domain.shelf.books.editMetadata,
        setStarred: domain.shelf.books.setStarred,
        setFinished: domain.shelf.books.setFinished,
        remove: domain.shelf.books.remove,
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
            const alive = await domain.shelf.books.get(existingId);
            if (alive) {
              await domain.shelf.books.updateVirtualBookTitle(
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
          const book = await domain.shelf.books.addVirtualBook({
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
            await domain.shelf.books.remove(bookId);
          } catch (error) {
            console.error("[plugins] virtual book removal", error);
          }
          unbindVirtualBook(bookId);
        },
      };
      ctx.shelf.collections.write = {
        create: domain.shelf.collections.create,
        rename: domain.shelf.collections.rename,
        remove: domain.shelf.collections.remove,
        assignBooks: domain.shelf.collections.assignBooks,
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
    const ask = async (input: {
      prompt: string;
      system?: string;
      model?: "fast" | "smart";
      schema?: Record<string, unknown>;
    }) => {
      const runtime = getAgentRuntime();
      if (!runtime) throw new Error("AI is not configured");
      const base = {
        prompt: String(input.prompt),
        system: input.system,
        model: input.model === "smart" ? ("smart" as const) : ("fast" as const),
      };
      return input.schema && typeof input.schema === "object"
        ? runtime.ask({ ...base, schema: input.schema })
        : runtime.ask(base);
    };
    ctx.llm = { ask } as PluginContext["llm"];
  }

  if (permissions.has("service:clipboard")) {
    ctx.clipboard = {
      writeText: (text) => navigator.clipboard.writeText(String(text)),
    };
  }

  return ctx;
}
