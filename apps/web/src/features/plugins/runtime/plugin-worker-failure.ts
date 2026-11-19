/**
 * Failures crossing the plugin Worker boundary, as the host logs them.
 *
 * A failure the Worker reports is rebuilt on the host from its message and
 * code, which is all callers and user-facing copy use. Rebuilt alone, it
 * names neither the plugin nor where it was thrown, so a log line read
 * `Error: Cannot read properties of undefined` at the host's message
 * handler. `workerFailure` attaches that origin as the error's `cause`,
 * which no caller or copy reads, so codes and messages are unchanged.
 */
import { AppError, errorCode } from "@read-aware/core";

/** `id@version`, the form every plugin failure in the log names its plugin by. */
export function pluginLabel(manifest: { id: string; version: string }): string {
  return `${manifest.id}@${manifest.version}`;
}

/** Which plugin threw, and the Worker's stack when it sent one. */
export class PluginWorkerOrigin extends Error {
  override name = "PluginWorker";

  constructor(plugin: string, workerStack?: string) {
    super(`thrown in plugin ${plugin}`);
    // The Worker's stack is plugin-controlled text. Indenting every line keeps
    // any of it from passing for a log line of its own.
    const frames = workerStack
      ?.split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `    ${line}`);
    this.stack = [`${this.name}: ${this.message}`, ...(frames ?? [])].join("\n");
  }
}

export function workerFailure(plugin: string, message: string, code?: string, stack?: string): Error {
  const cause = new PluginWorkerOrigin(plugin, stack);
  return code ? new AppError(code, message, { cause }) : new Error(message, { cause });
}

/**
 * Logs each distinct failure of a host call a plugin made once per Worker,
 * with the host-side error and its stack: the only record of where a host
 * service broke, since the Worker receives just the message and code.
 * Network requests keep a budget of their own, so a plugin polling many
 * unreachable feeds cannot use up the one its other failures need.
 * Cancellations are the caller's doing and are not reported.
 */
export class HostCallFailureLog {
  private readonly seen = new Map<"network" | "host", Set<string>>([
    ["network", new Set()],
    ["host", new Set()],
  ]);
  private readonly suppressed = new Set<"network" | "host">();

  constructor(
    private readonly plugin: string,
    private readonly warn: (message: string, ...detail: unknown[]) => void,
    private readonly limit = 32,
  ) {}

  report(method: string, failure: unknown): void {
    if (errorCode(failure) === "plugin/cancelled") return;
    const budget = method.startsWith("services.network.") ? "network" : "host";
    const seen = this.seen.get(budget)!;
    const text = (value: unknown) => (value instanceof Error ? value.message : String(value));
    const key = [
      method,
      errorCode(failure) ?? "",
      text(failure),
      failure instanceof Error ? text(failure.cause) : "",
    ].join("\u0000");
    if (seen.has(key)) return;
    if (seen.size >= this.limit) {
      if (!this.suppressed.has(budget)) {
        this.suppressed.add(budget);
        this.warn(`Further plugin ${budget} call failures are not logged`, this.plugin);
      }
      return;
    }
    seen.add(key);
    this.warn("Plugin host call failed", this.plugin, method, failure);
  }
}
