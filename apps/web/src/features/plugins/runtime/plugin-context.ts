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
import { fetch as corsFreeFetch } from "@tauri-apps/plugin-http";
import {
  domainGrantsFromPermissions,
  type DomainEventType,
  type SettingsAccessPolicy,
} from "@read-aware/core";
import { DEFAULT_LOCALE, i18n, isAppLocale } from "../../../i18n";
import { onAppEvent } from "../../../platform/app-events";
import { exportTextFile } from "../../../platform/export-file";
import { localKV } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import {
  deletePluginSecret,
  getPluginSecret,
  setPluginSecret,
} from "../../../platform/secret-store";
import {
  createActorDomainView,
  createSettingsDomain,
  type DomainEventSubscribe,
} from "../../../domain";
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
import { registerPluginSchedule } from "./plugin-scheduler";
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
  registerSettingsOptionsContribution,
  registerToolContribution,
  registerVoiceProviderContribution,
  updateVoiceProviderVoices,
} from "../state/plugin-store";

const log = createLogger("plugins");

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

/** Names for collections and secret keys: short, flat, no surprises. */
const NAMESPACE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

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

function requireSecretKey(key: string): void {
  if (!NAMESPACE_KEY.test(String(key))) {
    throw new Error(`invalid secret key: ${String(key)}`);
  }
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
  const selfOrigin = `plugin:${manifest.id}` as const;
  const domain = createActorDomainView(
    selfOrigin,
    domainGrantsFromPermissions(manifest.permissions ?? []),
  );
  const ownSettingsPaths = (manifest.settings ?? [])
    .filter(
      (field) =>
        field.kind !== "secret" &&
        !(field.kind === "text" && field.inputMode === "password"),
    )
    .map((field) => `plugins.${manifest.id}.${field.id}`);
  const requestedSettings = manifest.settingsAccess ?? {};
  const settingsAccess: SettingsAccessPolicy = {
    discover: [...(requestedSettings.discover ?? []), ...ownSettingsPaths],
    read: [...(requestedSettings.read ?? []), ...ownSettingsPaths],
    write: [...(requestedSettings.write ?? []), ...ownSettingsPaths],
  };
  const settingsDomain = createSettingsDomain(selfOrigin, settingsAccess);
  const storagePrefix = pluginStoragePrefix(manifest.id);
  const track = (disposable: PluginDisposable): PluginDisposable => {
    disposables.push(disposable);
    return disposable;
  };
  const brand = { pluginId: manifest.id, pluginName: manifest.name };

  /**
   * Domain `on` returns a bare unsubscribe; plugins get a tracked disposable,
   * plus the `ignoreSelf` option that mutes this plugin's own write echoes.
   */
  const trackedOn = <E extends DomainEventType>(on: DomainEventSubscribe<E>) =>
    ((
      event: never,
      handler: (broadcast: { origin?: string }) => void,
      options?: { ignoreSelf?: boolean },
    ) => {
      const wrapped =
        options?.ignoreSelf === true
          ? (broadcast: { origin?: string }) => {
              if (broadcast.origin !== selfOrigin) handler(broadcast);
            }
          : handler;
      return track({ dispose: on(event, wrapped as never) });
    }) as never;

  const ctx: PluginContext = {
    manifest,
    appVersion,
    // Live read — the worker mirrors this via the sync channel instead.
    get locale() {
      return currentAppLocale();
    },
    domains: {
      settings: {
        queries: {
          discover: settingsDomain.queries.discover,
          read: settingsDomain.queries.read,
        },
        commands: { update: settingsDomain.commands.update },
        events: {
          subscribe: (handler, options) =>
            track({
              dispose: settingsDomain.events.subscribe((event) => {
                if (options?.ignoreSelf && event.origin === selfOrigin) return;
                const report = (error: unknown) =>
                  log.error(`settings handler from "${manifest.id}" failed`, error);
                try {
                  const result = handler(event) as unknown;
                  if (result instanceof Promise) result.catch(report);
                } catch (error) {
                  report(error);
                }
              }),
            }),
        },
      },
    },
    contributions: {
      selectionActions: {
        register: (action) =>
          track(
            registerSelectionActionContribution({
              ...action,
              ...brand,
              key: contributionKey(manifest.id, action.id),
            }),
          ),
      },
      headerActions: {
        register: (action) =>
          track(
            registerHeaderActionContribution({
              ...action,
              ...brand,
              presentation:
                action.surface === "reader" ? "popup" : (action.presentation ?? "popup"),
              key: contributionKey(manifest.id, action.id),
            }),
          ),
      },
      commands: {
        register: (command) =>
          track(
            registerCommandContribution({
              ...command,
              defaultShortcut: normalizeDefaultShortcut(command.defaultShortcut),
              ...brand,
              key: contributionKey(manifest.id, command.id),
            }),
          ),
      },
      settingsOptions: {
        register: (fieldId, provider) => {
          const id = String(fieldId);
          const declared = manifest.settings?.find((field) => field.id === id);
          if (!declared || declared.kind !== "select" || declared.dynamicOptions !== true) {
            throw new Error(
              `settings field "${id}" is not declared as a dynamicOptions select in manifest.settings`,
            );
          }
          if (typeof provider !== "function") {
            throw new Error("settingsOptions.register requires a provider function");
          }
          return track(
            registerSettingsOptionsContribution({
              key: contributionKey(manifest.id, `settings-options.${id}`),
              pluginId: manifest.id,
              fieldId: id,
              resolve: (values) => Promise.resolve(provider(values)),
            }),
          );
        },
      },
      voiceProviders: {
        register: (provider) => {
        const key = contributionKey(manifest.id, provider.id);
        const registration = registerVoiceProviderContribution({
          ...provider,
          ...brand,
          key,
          voices: [],
        });
        const refreshVoices = () => {
          Promise.resolve(provider.listVoices())
            .then((voices) =>
              updateVoiceProviderVoices(key, Array.isArray(voices) ? voices : []),
            )
            .catch((error) =>
              log.warn(
                `listVoices from "${manifest.id}" failed`,
                error,
              ),
            );
        };
        refreshVoices();
        // A vendor/voice switch in the plugin's settings changes what
        // voices exist — re-list so pickers stay truthful.
        const offStorage = onAppEvent("plugin-storage-changed", ({ pluginId }) => {
          if (pluginId === manifest.id) refreshVoices();
        });
        return track({
          dispose: () => {
            offStorage();
            registration.dispose();
          },
        });
        },
      },
      contentProviders: {
        register: (provider) =>
          track(
            registerContentProviderContribution({
              key: `${manifest.id}:${provider.id}`,
              pluginId: manifest.id,
              providerId: String(provider.id),
              load: (bookKey: string) => Promise.resolve(provider.load(bookKey)),
            }),
          ),
      },
      readerModes: permissions.has("reader:modes")
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
      agentTools: permissions.has("agent:tools")
        ? {
            register: (tool) =>
              track(
                registerToolContribution({
                  ...tool,
                  ...brand,
                  key: contributionKey(manifest.id, tool.name),
                }),
              ),
          }
        : undefined,
    },
    services: {
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
        onChange: (handler) =>
          track({
            dispose: onAppEvent("plugin-storage-changed", ({ pluginId }) => {
              if (pluginId !== manifest.id) return;
              try {
                handler();
              } catch (error) {
                log.error(`storage.onChange handler from "${manifest.id}" failed`, error);
              }
            }),
          }),
        collection: (name) => {
          const collection = String(name);
          if (!NAMESPACE_KEY.test(collection)) {
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
      secrets: {
        get: (key) => {
          requireSecretKey(key);
          return getPluginSecret(manifest.id, key);
        },
        set: async (key, value) => {
          requireSecretKey(key);
          await setPluginSecret(manifest.id, key, String(value));
        },
        remove: async (key) => {
          requireSecretKey(key);
          await deletePluginSecret(manifest.id, key);
        },
      },
      ui: {
        showToast: (message) => showPluginToast(String(message)),
        exportFile: (file) => {
          const content = file?.content;
          const binary = content instanceof Uint8Array || content instanceof ArrayBuffer;
          if (!file || typeof file.filename !== "string" || (typeof content !== "string" && !binary)) {
            throw new Error("exportFile requires a filename and text or binary content");
          }
          return exportTextFile({
            filename: file.filename,
            content,
            mimeType: typeof file.mimeType === "string" ? file.mimeType : undefined,
          });
        },
      },
      schedules: {
        bind: (scheduleId, run) => {
          const declaration = manifest.schedules?.find(
            (entry) => entry.id === scheduleId,
          );
          if (!declaration) {
            throw new Error(
              `schedule "${scheduleId}" is not declared in manifest.schedules`,
            );
          }
          return track(registerPluginSchedule(manifest.id, declaration, run));
        },
      },
      session: {
        subscribe: (event, handler) => {
        if (!SESSION_EVENTS.includes(event)) {
          throw new Error(`"${String(event)}" is not a session event`);
        }
        const off = onAppEvent(event, ((payload: PluginSessionEventMap[typeof event]) => {
          const report = (error: unknown) =>
            log.error(`event handler from "${manifest.id}" failed`, error);
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
    },
  };

  // The registry already applied domain permissions. This layer only adapts
  // host-only details such as tracked subscriptions and virtual-book bindings.
  if (domain.library) {
    const library = domain.library;
    ctx.domains.library = {
      queries: library.queries,
      events: { subscribe: trackedOn(library.events.subscribe) },
    };
    if (library.commands) {
      ctx.domains.library.commands = {
        books: {
          importBook: library.commands.books.importBook,
          editMetadata: library.commands.books.editMetadata,
          setStarred: library.commands.books.setStarred,
          remove: library.commands.books.remove,
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
            const alive = await library.queries.books.get(existingId);
            if (alive) {
              await library.commands!.books.updateVirtualBookTitle(
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
          const book = await library.commands!.books.addVirtualBook({
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
            await library.commands!.books.remove(bookId);
          } catch (error) {
            log.error("virtual book removal failed", error);
          }
          unbindVirtualBook(bookId);
          },
        },
        collections: library.commands.collections,
      };
    }
  }

  if (domain.reading) {
    const reading = domain.reading;
    ctx.domains.reading = {
      queries: reading.queries,
      events: { subscribe: trackedOn(reading.events.subscribe) },
    };
    if (reading.commands) {
      ctx.domains.reading.commands = {
        setFinished: reading.commands.setFinished,
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
      };
    }
  }

  if (domain.annotations) {
    const annotations = domain.annotations;
    ctx.domains.annotations = {
      queries: annotations.queries,
      events: { subscribe: trackedOn(annotations.events.subscribe) },
    };
    if (annotations.commands) {
      ctx.domains.annotations.commands = {
        createHighlight: annotations.commands.createHighlight,
        recolorHighlight: annotations.commands.recolorHighlight,
        removeHighlight: annotations.commands.removeHighlight,
        createNote: annotations.commands.createNote,
        updateNote: annotations.commands.updateNote,
        removeNote: annotations.commands.removeNote,
      };
    }
  }

  if (domain.conversations) {
    ctx.domains.conversations = {
      queries: domain.conversations.queries,
      events: {
        subscribe: trackedOn(domain.conversations.events.subscribe),
      },
    };
  }

  // ─── Services ─────────────────────────────────────────────────────────────

  if (permissions.has("service:network")) {
    ctx.services.network = {
      // The Rust HTTP client (tauri-plugin-http), not webview fetch: plugin
      // requests must reach hosts that never heard of CORS. Scope lives in
      // the capability file (https + localhost), not in the webview CSP.
      fetch: (input, init) => corsFreeFetch(input, init),
    };
  }

  if (permissions.has("service:llm")) {
    const ask = async (input: {
      prompt: string;
      system?: string;
      model?: "fast" | "smart";
      schema?: Record<string, unknown>;
      onText?: (delta: string) => void;
    }) => {
      const runtime = getAgentRuntime();
      if (!runtime) throw new Error("AI is not configured");
      const base = {
        prompt: String(input.prompt),
        system: input.system,
        model: input.model === "smart" ? ("smart" as const) : ("fast" as const),
      };
      if (input.schema && typeof input.schema === "object") {
        return runtime.ask({ ...base, schema: input.schema });
      }
      return runtime.ask({
        ...base,
        onText: typeof input.onText === "function" ? input.onText : undefined,
      });
    };
    ctx.services.llm = { ask } as PluginContext["services"]["llm"];
  }

  if (permissions.has("service:clipboard")) {
    ctx.services.clipboard = {
      writeText: (text) => navigator.clipboard.writeText(String(text)),
    };
  }

  return ctx;
}
