/**
 * Builds the `ctx` handed to a plugin's activate(): the whole API surface,
 * with permission-gated capability groups (docs/plugin-system.md §4). Gating
 * here is API-level — it prevents accidental overreach, not malice; the trust
 * boundary is installation itself (§2).
 */
import { localKV } from "../../../platform/local-store";
import { getAgentRuntime } from "../../ai/agent/agent-runtime";
import { createAnnotationsPort } from "../../ai/agent/ports/annotations-port";
import { createDictionaryPort } from "../../ai/agent/ports/dictionary-port";
import { createLibraryPort } from "../../ai/agent/ports/library-port";
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
    ctx.reading = {
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
        return runtime.ask({ prompt: String(input.prompt), system: input.system });
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
