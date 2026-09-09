import { AppError } from "@read-aware/core";
import type { PluginActionRegistration, PluginActionState } from "../lib/plugin-types";
import { actionEnabled, normalizeActionState } from "../lib/plugin-action-state";
import { guardPluginCallback, pluginCallbackOwner } from "../runtime/plugin-callback-wire";
import { createContributionRegistry, type ContributionIdentity, type ContributionPoint } from "./contribution-registry";

/** Immutable presentation snapshots, with an execution guard shared by every consumer. */
export function createInteractiveContributionRegistry<T extends ContributionIdentity & { state?: PluginActionState }>(
  point: ContributionPoint, method: keyof T, options: { catalog?: boolean } = {},
) {
  const registry = createContributionRegistry<T>(point, options);
  return { ...registry, register(item: T): PluginActionRegistration {
    const callback = item[method];
    if (typeof callback !== "function") throw new AppError("plugin/invalid-input", "Contribution callback is required");
    let state = normalizeActionState(item.state === undefined ? { revision: 0, visible: true, enabled: true } : item.state), retired = false;
    const owner = pluginCallbackOwner(callback);
    const current = () => !retired && !owner?.aborted && registry.find(entry => entry.key === item.key)?.[method] === wrapped;
    const wrapped = guardPluginCallback(callback as (...args: never[]) => unknown, () => {
      if (!current()) throw new AppError("plugin/unavailable", "Contribution registration has retired");
      if (!actionEnabled({ state })) throw new AppError("plugin/action-disabled", "Contribution is not currently available");
    });
    const registered = { ...item, state, [method]: wrapped } as T;
    const registration = registry.register(registered);
    return {
      dispose() { retired = true; registration.dispose(); },
      async updateState(raw) {
        if (!current()) return { status: "inactive" };
        const next = normalizeActionState(raw);
        if (next.revision <= state.revision) return { status: "stale" };
        state = next;
        registry.update(item.key, entry => ({ ...entry, state: next }));
        return { status: "applied" };
      },
    };
  } };
}
