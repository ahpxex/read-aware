import { AppError, normalizeReadingIntentScope, normalizeReadingIntentSnapshot,
  type ReadingIntentScope, type ReadingIntentSource } from "@read-aware/core";
import type { PluginAgentContextProvider, RegisteredAgentContextProvider } from "../lib/plugin-types";
import type { PluginLifecycleController } from "./plugin-lifecycle";
import { getRegisteredAgentContextProviders } from "../state/plugin-store";
import { subscribeContributions } from "../state/contribution-registry";
import { getBookRecord } from "../../library/lib/library-db";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reading-intention-sources");
function waitForSource<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    void work.then(value => { signal.removeEventListener("abort", cancel); if (signal.aborted) reject(signal.reason); else resolve(value); }, error => {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted && error !== signal.reason && !(error instanceof Error && error.name === "AbortError")) log.warn("Retired intention source failed", error);
      reject(signal.aborted ? signal.reason : error);
    });
  });
}

export function wrapReadingIntent(source: PluginAgentContextProvider["readingIntent"], lifecycle: PluginLifecycleController) {
  if (source === undefined) return undefined;
  if (!source || Object.keys(source).sort().join(",") !== "prepare,read,scopes" || !Array.isArray(source.scopes)
    || !source.scopes.length || source.scopes.some(scope => scope !== "user" && scope !== "book")
    || new Set(source.scopes).size !== source.scopes.length || typeof source.prepare !== "function" || typeof source.read !== "function") {
    throw new AppError("plugin/invalid-input", "Invalid reading intention provider");
  }
  const scopes = [...source.scopes], prepare = source.prepare.bind(source), read = source.read.bind(source);
  const check = (input: ReadingIntentScope) => {
    const scope = normalizeReadingIntentScope(input);
    lifecycle.signal.throwIfAborted();
    lifecycle.assertActive("readingIntent");
    if (!scopes.includes(scope.kind)) throw new AppError("memory/forbidden", "Reading intention scope not declared");
    return scope;
  };
  return { scopes,
    prepare: (input: ReadingIntentScope) => {
      const scope = check(input);
      return lifecycle.read("readingIntent.prepare", async () => { await prepare(scope); check(scope); });
    },
    read: (input: ReadingIntentScope) => {
      const scope = check(input);
      return lifecycle.read("readingIntent.read", async () => {
        const value = await read(scope); check(scope); return normalizeReadingIntentSnapshot(value);
      });
    },
  };
}

type SourceHost = {
  list(): RegisteredAgentContextProvider[];
  observe(listener: () => void): () => void;
  requireBook(id: string): Promise<void>;
};

/** One frozen provider set spans preparation, source reads and native dispatch. */
export function createReadingIntentSources(host: SourceHost) {
  return {
    open(input: ReadingIntentScope, caller?: AbortSignal) {
      const scope = normalizeReadingIntentScope(input), changes = new AbortController();
      const list = () => host.list().filter(provider => provider.readingIntent?.scopes.includes(scope.kind));
      const providers = list();
      const signal = AbortSignal.any([changes.signal, ...(caller ? [caller] : []),
        ...providers.flatMap(provider => provider.readingIntentLifetime ? [provider.readingIntentLifetime] : [])]);
      const check = () => {
        const current = list();
        if (current.length !== providers.length || current.some(provider => !providers.includes(provider))) {
          changes.abort(new AppError("memory/conflict", "Reading intention providers changed during capture"));
        }
        signal.throwIfAborted();
      };
      // Observers invalidate the lease without throwing into registry updates.
      const dispose = host.observe(() => {
        const current = list();
        if (current.length !== providers.length || current.some(provider => !providers.includes(provider))) {
          changes.abort(new AppError("memory/conflict", "Reading intention providers changed during capture"));
        }
      });
      const requireBook = async () => { check(); if (scope.kind === "book") await waitForSource(host.requireBook(scope.id), signal); check(); };
      return { signal, dispose,
        prepare: async () => {
          await requireBook();
          for (const provider of providers) { check(); await waitForSource(provider.readingIntent!.prepare({ ...scope }), signal); check(); }
        },
        read: async (): Promise<ReadingIntentSource[]> => {
          await requireBook();
          const sources: ReadingIntentSource[] = [];
          for (const provider of providers) {
            check(); const snapshot = normalizeReadingIntentSnapshot(await waitForSource(provider.readingIntent!.read({ ...scope }), signal)); check();
            sources.push({ pluginId: provider.pluginId, providerId: provider.id, ...snapshot });
          }
          return sources;
        },
      };
    },
  };
}

export const readingIntentSources = createReadingIntentSources({ list: getRegisteredAgentContextProviders, observe: subscribeContributions,
  requireBook: async id => { if (!await getBookRecord(id)) throw new AppError("reader/book-not-found", "Reading intention book no longer exists"); } });
