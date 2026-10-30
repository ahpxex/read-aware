import type { PluginContext } from "../../lib/plugin-types";
import type { PluginActorKit } from "./kit";

/** The settings domain as seen by one actor: queries, commands and tracked change events. */
export function settingsDomainFacet(kit: PluginActorKit): PluginContext["domains"]["settings"] {
  const { permissions, selfOrigin, lifecycle, callSignal, settingsDomain, track, deliverSettingsEvent } = kit;
  return {
    queries: {
      modelCatalog: (query) =>
        lifecycle.read("settings.modelCatalog", () => settingsDomain.queries.modelCatalog(query)),
      snapshot: async (query) => {
        lifecycle.signal.throwIfAborted();
        const result = await settingsDomain.queries.snapshot(query);
        lifecycle.signal.throwIfAborted();
        return result;
      },
      observe: (query, handler) => track(() => ({ dispose: settingsDomain.queries.observe(query, handler) })),
      discover: async (query) => {
        lifecycle.signal.throwIfAborted();
        const result = await settingsDomain.queries.discover(query);
        lifecycle.signal.throwIfAborted();
        return result;
      },
      options: async (query) => {
        // A plugin-owned list can invoke a provider, unlike static catalog reads.
        if (typeof query?.path === "string" && query.path.startsWith("plugins."))
          lifecycle.assertActive("settings.options");
        return lifecycle.read("settings.options", (signal) => settingsDomain.queries.options(query, signal));
      },
      read: async (path, target) => {
        lifecycle.signal.throwIfAborted();
        const result = await settingsDomain.queries.read(path, target);
        lifecycle.signal.throwIfAborted();
        return result;
      },
    },
    commands: {
      ...(permissions.has("service:network")
        ? {
            refreshModelCatalog: (provider: string, options?: import("@read-aware/plugin-types").PluginCallOptions) => {
              // A shared network refresh is an external effect, so it waits for promotion like every other command.
              lifecycle.assertActive("domains.settings.commands.refreshModelCatalog");
              return lifecycle.read(
                "settings.refreshModelCatalog",
                (signal) => settingsDomain.commands.refreshModelCatalog(provider, signal),
                callSignal(options),
              );
            },
          }
        : {}),
      resetReading: (request) => {
        lifecycle.assertActive("domains.settings.commands.resetReading");
        return settingsDomain.commands.resetReading(request, lifecycle.signal);
      },
      update: (changes) => {
        lifecycle.assertActive("domains.settings.commands.update");
        return settingsDomain.commands.update(changes, lifecycle.signal);
      },
    },
    events: {
      subscribe: (handler, options) =>
        track(() => ({
          dispose: settingsDomain.events.subscribe((event) => {
            if (options?.ignoreSelf && event.origin === selfOrigin) return;
            deliverSettingsEvent(handler, event);
          }),
        })),
    },
  };
}
