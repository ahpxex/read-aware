import { AppError } from "@read-aware/core";
import type { PluginCallOptions } from "@read-aware/plugin-types";

/** Final options argument positions shared by the Worker proxy and host RPC.
 * Transport metadata is not authority: the host still resolves the actor's method. */
export const PLUGIN_CALL_OPTIONS = {
  "domains.memory.queries.entities": 1,
  "domains.memory.commands.decideEntity": 1,
  "services.maintenance.requestConnectionTest": 0,
  "domains.settings.commands.refreshModelCatalog": 1,
  "services.maintenance.requestBackup": 1,
  "services.diagnostics.verifyProjections": 0,
  "services.diagnostics.requestReport": 1,
  "services.sync.requestFlow": 1,
  "domains.library.queries.books.inspectResource": 1,
  "domains.library.queries.books.getNavigationToc": 1,
  "domains.library.queries.books.listNavigationTargets": 1,
  "domains.library.queries.books.searchLocations": 1,
  "domains.library.queries.books.readRange": 1,
  "domains.library.queries.books.listReferences": 1,
  "domains.library.queries.books.listImages": 1,
  "domains.library.queries.books.readReference": 1,
  "domains.library.queries.books.searchText": 1,
  "domains.library.queries.books.getContentState": 1,
  "domains.reading.commands.putEmphasis": 2,
  "domains.reading.commands.removeEmphasis": 2,
  "domains.reading.commands.selectRange": 2,
  "domains.reading.commands.clearSelection": 2,
  "domains.reading.commands.openBook": 1,
  "domains.reading.commands.goTo": 1,
  "domains.reading.commands.back": 1,
  "domains.reading.commands.forward": 1,
  "domains.reading.commands.step": 2,
  "domains.reading.commands.reload": 1,
  "domains.reading.commands.close": 1,
  "domains.reading.commands.controlPlayback": 2,
  "domains.reading.commands.configureMode": 2,
  "domains.reading.commands.setControls": 2,
  "domains.reading.commands.returnToMode": 1,
  "domains.reading.commands.stepMode": 2,
} as const;

/** These conditional writes arbitrate cancellation at dispatch, not in the proxy.
 * A deadline or lost realm still leaves the outcome unknown; never retry blindly. */
export function pluginCallDrainsCancellation(method: string): boolean {
  return method === "domains.memory.commands.decideEntity";
}

function position(method: string): number | undefined {
  return Object.hasOwn(PLUGIN_CALL_OPTIONS, method) ? PLUGIN_CALL_OPTIONS[method as keyof typeof PLUGIN_CALL_OPTIONS] : undefined;
}

function validate(options: unknown, rawWire = false): PluginCallOptions | undefined {
  if (options === undefined) return undefined;
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some(key => key !== "signal")
    || !rawWire && (options as PluginCallOptions).signal !== undefined && !((options as PluginCallOptions).signal instanceof AbortSignal)) {
    throw new AppError("plugin/invalid-argument", "Invalid plugin call options");
  }
  return options as PluginCallOptions;
}

export function pluginOperationSignal(realm: AbortSignal, options?: PluginCallOptions): AbortSignal {
  const signal = validate(options)?.signal;
  const combined = signal ? AbortSignal.any([realm, signal]) : realm;
  combined.throwIfAborted();
  return combined;
}

export function preparePluginCall(method: string, args: unknown[]): { args: unknown[]; signal?: AbortSignal } {
  const index = position(method);
  if (index === undefined) return { args };
  const options = validate(args[index]);
  const wire = [...args];
  // Preserve preceding optional guards; no AbortSignal crosses structured clone.
  if (wire.length > index) wire[index] = undefined;
  return { args: wire, signal: options?.signal };
}

export function injectPluginCallSignal(method: string, args: unknown[], signal: AbortSignal): void {
  const index = position(method);
  if (index === undefined) return;
  validate(args[index], true);
  while (args.length < index) args.push(undefined);
  args[index] = { signal };
}
