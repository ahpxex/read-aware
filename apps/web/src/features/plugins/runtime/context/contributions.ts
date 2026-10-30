import { prepareRuntimeTheme, readerThemeBases } from "../plugin-runtime-theme";
import type { DomainActor } from "../../../../platform/domain-actor";
import { pluginUriRegistry } from "../../lib/plugin-uri";
import { normalizeActionState } from "../../lib/plugin-action-state";
import { assertToolApproval } from "../../lib/plugin-tool-approval";
import { resolvePluginBookCards } from "../plugin-book-cards";
import { wrapReadingIntent } from "../plugin-reading-intents";
import { AppError, canUseContribution } from "@read-aware/core";
import { normalizeReaderMode } from "../../lib/reader-mode";
import { contributionKey, type PluginContext } from "../../lib/plugin-types";
import { registerSyncTransport } from "../../../../platform/sync/transport-registry";
import { releasePluginCallbacks } from "../plugin-callback-wire";
import {
  registerThemeContribution,
  registerSettingsPageContribution,
  registerCommandContribution,
  registerContextActionContribution,
  registerAgentContextProviderContribution,
  registerAgentRetrievalProviderContribution,
  registerHeaderActionContribution,
  registerReaderModeContribution,
  registerSelectionActionContribution,
  registerSettingsOptionsContribution,
  registerToolContribution,
  registerMemoryCandidateProviderContribution,
} from "../../state/plugin-store";
import { registerPluginVoiceProvider } from "../plugin-voice-provider";
import { registerPluginContentProvider } from "../plugin-content-provider";
import { pluginObjectAccessDenied } from "../../../../domain/plugin-object-access";
import { NAMESPACE_KEY, normalizeDefaultShortcut } from "./helpers";
import type { PluginActorKit } from "./kit";

/** Contribution points: every registration is branded with the plugin and tracked for retirement. */
export function contributionsFacet(kit: PluginActorKit, self: () => PluginContext): PluginContext["contributions"] {
  const {
    manifest,
    grantedBookAccess,
    permissions,
    lifecycle,
    objectAccess,
    assertBookScope,
    scopedRead,
    resources,
    domain,
    trackContribution,
    trackAction,
    brand,
  } = kit;
  return {
    settingsPage: {
      register: (page) =>
        trackContribution((source) =>
          registerSettingsPageContribution(
            { ...brand, key: contributionKey(manifest.id, "settings"), view: page.view },
            source,
          ),
        ),
    },
    ...(canUseContribution("themes", permissions)
      ? {
          themes: {
            readerBases: () => lifecycle.read("themes.readerBases", async () => readerThemeBases(), lifecycle.signal),
            register: async (input) => {
              const prepared = await prepareRuntimeTheme(input, manifest, lifecycle, resources);
              return trackContribution((source) => {
                const background = prepared.background;
                const url = background ? URL.createObjectURL(background.blob) : undefined;
                try {
                  const registration = registerThemeContribution(
                    {
                      ...prepared.theme,
                      ...brand,
                      key: contributionKey(manifest.id, prepared.theme.id),
                      readerBackground:
                        background && url ? { url, opacity: background.opacity, dim: background.dim } : undefined,
                    },
                    source,
                  );
                  return {
                    dispose: (origin) => {
                      registration.dispose(origin);
                      if (url) URL.revokeObjectURL(url);
                    },
                  };
                } catch (error) {
                  if (url) URL.revokeObjectURL(url);
                  throw error;
                }
              });
            },
          },
        }
      : {}),
    uriHandlers: {
      register: (handler) => {
        if (
          !handler ||
          typeof handler !== "object" ||
          typeof handler.id !== "string" ||
          !NAMESPACE_KEY.test(handler.id) ||
          typeof handler.open !== "function"
        )
          throw new AppError("plugin/invalid-input", "Invalid URI handler");
        const captured = {
          id: handler.id,
          open: handler.open,
          ...(handler.state === undefined ? {} : { state: normalizeActionState(handler.state) }),
        };
        return trackAction((source) =>
          pluginUriRegistry.register({ ...captured, ...brand, key: contributionKey(manifest.id, captured.id) }, source),
        );
      },
    },
    selectionActions: {
      register: (action) =>
        trackAction((source) =>
          registerSelectionActionContribution(
            {
              ...action,
              ...(objectAccess.restricted
                ? {
                    run: (input) => {
                      assertBookScope(input.book.id);
                      if (input.range) assertBookScope(input.range.bookId);
                      return action.run(input);
                    },
                  }
                : {}),
              ...brand,
              key: contributionKey(manifest.id, action.id),
            },
            source,
          ),
        ),
    },
    headerActions: {
      register: (action) =>
        trackAction((source) => {
          if (!["shelf", "reader", "agent"].includes(action.surface)) {
            throw new AppError("plugin/invalid-input", "Unknown header surface");
          }
          return registerHeaderActionContribution(
            {
              ...action,
              ...(objectAccess.restricted
                ? {
                    view: (input) => {
                      if (input.book) assertBookScope(input.book.id);
                      return action.view(input);
                    },
                  }
                : {}),
              ...brand,
              presentation: action.surface !== "shelf" ? "popup" : (action.presentation ?? "popup"),
              key: contributionKey(manifest.id, action.id),
            },
            source,
          );
        }),
    },
    contextActions: {
      register: (action) =>
        trackAction((source) => {
          if (!["book", "collection"].includes(action.surface)) {
            throw new AppError("plugin/invalid-input", "Unknown context surface");
          }
          return registerContextActionContribution(
            {
              ...action,
              ...(objectAccess.restricted
                ? {
                    run: (input) => {
                      if (input.surface === "book") assertBookScope(input.book.id);
                      return action.run(input);
                    },
                  }
                : {}),
              ...brand,
              key: contributionKey(manifest.id, action.id),
            },
            source,
          );
        }),
    },
    commands: {
      register: (command) =>
        trackAction((source) =>
          registerCommandContribution(
            {
              ...command,
              defaultShortcut: normalizeDefaultShortcut(command.defaultShortcut),
              ...brand,
              key: contributionKey(manifest.id, command.id),
            },
            source,
          ),
        ),
    },
    settingsOptions: {
      register: (fieldId, provider) => {
        const id = String(fieldId);
        const declared = manifest.settings?.find((field) => field.id === id);
        if (!declared || declared.kind !== "select" || declared.dynamicOptions !== true) {
          throw new Error(`settings field "${id}" is not declared as a dynamicOptions select in manifest.settings`);
        }
        if (typeof provider !== "function") {
          throw new Error("settingsOptions.register requires a provider function");
        }
        return trackContribution((source) =>
          registerSettingsOptionsContribution(
            {
              key: contributionKey(manifest.id, `settings-options.${id}`),
              pluginId: manifest.id,
              fieldId: id,
              resolve: (values) => Promise.resolve(provider(values)),
            },
            source,
          ),
        );
      },
    },
    voiceProviders: {
      register: (provider) =>
        trackContribution((source) => registerPluginVoiceProvider(provider, brand, lifecycle, source)),
    },
    contentProviders: {
      register: (provider) =>
        trackContribution((source) => registerPluginContentProvider(manifest.id, provider, lifecycle.signal, source)),
    },
    readerModes: canUseContribution("readerModes", permissions)
      ? {
          register: (mode) => {
            const normalized = normalizeReaderMode(mode);
            return trackContribution((source) =>
              registerReaderModeContribution(
                {
                  ...normalized,
                  ...brand,
                  key: contributionKey(manifest.id, normalized.id),
                },
                source,
              ),
            );
          },
        }
      : undefined,
    agentTools: canUseContribution("agentTools", permissions)
      ? {
          register: (tool) => {
            assertToolApproval(tool.approval, manifest.requires.contributions?.agentTools);
            return trackAction((source) =>
              registerToolContribution(
                {
                  ...tool,
                  ...brand,
                  key: contributionKey(manifest.id, tool.name),
                  resolveBookCards: domain.library
                    ? (ids, signal) =>
                        lifecycle.read(
                          "agentTools.bookCards",
                          (active) => resolvePluginBookCards(ids, self().domains.library!.queries.books.list, active),
                          signal,
                        )
                    : undefined,
                  ...(objectAccess.restricted
                    ? { bookAccess: grantedBookAccess, assertBookAccess: assertBookScope }
                    : {}),
                },
                source,
              ),
            );
          },
        }
      : undefined,
    agentContextProviders: canUseContribution("agentContextProviders", permissions)
      ? {
          register: (provider) => {
            const readingIntent = wrapReadingIntent(provider.readingIntent, lifecycle);
            return trackContribution((source) =>
              registerAgentContextProviderContribution(
                {
                  ...provider,
                  ...brand,
                  key: contributionKey(manifest.id, provider.id),
                  provide: objectAccess.restricted
                    ? (input) => {
                        if (input.scope.kind === "book") {
                          assertBookScope(input.scope.bookId);
                          return scopedRead(input.scope.bookId, "agent context provider", () =>
                            Promise.resolve(provider.provide(input)),
                          );
                        }
                        if (grantedBookAccess.mode !== "all")
                          throw pluginObjectAccessDenied("agent context provider global scope");
                        return provider.provide(input);
                      }
                    : provider.provide,
                  readingIntent:
                    readingIntent && objectAccess.restricted
                      ? {
                          ...readingIntent,
                          prepare: (scope) => {
                            if (scope.kind === "book")
                              return scopedRead(scope.id, "reading intention.prepare", () =>
                                readingIntent.prepare(scope),
                              );
                            else if (grantedBookAccess.mode !== "all")
                              throw pluginObjectAccessDenied("reading intention global scope");
                            return readingIntent.prepare(scope);
                          },
                          read: (scope) => {
                            if (scope.kind === "book")
                              return scopedRead(scope.id, "reading intention.read", () => readingIntent.read(scope));
                            else if (grantedBookAccess.mode !== "all")
                              throw pluginObjectAccessDenied("reading intention global scope");
                            return readingIntent.read(scope);
                          },
                        }
                      : readingIntent,
                  readingIntentLifetime: lifecycle.signal,
                  ...(objectAccess.restricted
                    ? { bookAccess: grantedBookAccess, assertBookAccess: assertBookScope }
                    : {}),
                },
                source,
              ),
            );
          },
        }
      : undefined,
    agentRetrievalProviders: canUseContribution("agentRetrievalProviders", permissions)
      ? {
          register: (provider) =>
            trackContribution((source) =>
              registerAgentRetrievalProviderContribution(
                {
                  ...provider,
                  ...brand,
                  key: contributionKey(manifest.id, provider.id),
                  retrieve: objectAccess.restricted
                    ? (input) => {
                        if (input.scope.kind === "book")
                          return scopedRead(input.scope.bookId, "agent retrieval provider", () =>
                            Promise.resolve(provider.retrieve(input)),
                          );
                        throw pluginObjectAccessDenied("agent retrieval provider global scope");
                      }
                    : provider.retrieve,
                  ...(objectAccess.restricted
                    ? { bookAccess: grantedBookAccess, assertBookAccess: assertBookScope }
                    : {}),
                },
                source,
              ),
            ),
        }
      : undefined,
    memoryCandidateProviders: canUseContribution("memoryCandidateProviders", permissions)
      ? {
          register: (provider) =>
            trackContribution((source) =>
              registerMemoryCandidateProviderContribution(
                {
                  ...provider,
                  ...(objectAccess.restricted
                    ? {
                        propose: async (input) => {
                          if (input.scope.kind !== "book")
                            throw pluginObjectAccessDenied("memory candidate provider global scope");
                          const fence = await objectAccess.beginBook(input.scope.bookId, "memory candidate provider");
                          try {
                            const proposals = await provider.propose(input);
                            await fence.assertUnchanged();
                            if (
                              !Array.isArray(proposals) ||
                              proposals.some((candidate) => candidate.scope !== "book")
                            ) {
                              throw pluginObjectAccessDenied("memory candidate provider result");
                            }
                            return proposals;
                          } catch (error) {
                            fence.dispose();
                            throw error;
                          }
                        },
                        bookAccess: grantedBookAccess,
                        assertBookAccess: assertBookScope,
                      }
                    : {}),
                  ...brand,
                  key: contributionKey(manifest.id, provider.id),
                },
                source,
              ),
            ),
        }
      : undefined,
    syncTransports: canUseContribution("syncTransports", permissions)
      ? {
          register: (transport) => {
            if (!NAMESPACE_KEY.test(String(transport?.id))) {
              throw new Error(`invalid sync transport id: ${String(transport?.id)}`);
            }
            if (typeof transport.open !== "function") {
              throw new Error("syncTransports.register requires an open() function");
            }
            return trackContribution((source) => {
              const unregister = registerSyncTransport(
                manifest.id,
                {
                  id: String(transport.id),
                  label: transport.label,
                  open: transport.open,
                },
                releasePluginCallbacks,
                source,
              );
              let disposed = false;
              const dispose = (retirement: DomainActor = source) => {
                if (disposed) return;
                disposed = true;
                lifecycle.signal.removeEventListener("abort", cancel);
                lifecycle.trackCleanup(unregister(retirement));
              };
              const cancel = () => dispose(source);
              // Retire session waiters before native cancellation races back
              // through provider callbacks during the quiescence barrier.
              lifecycle.signal.addEventListener("abort", cancel, { once: true });
              if (lifecycle.signal.aborted) dispose();
              return { dispose };
            });
          },
        }
      : undefined,
  };
}
