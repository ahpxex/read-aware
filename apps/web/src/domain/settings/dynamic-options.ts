import { AppError, pageSettingOptions, type SettingOption, type SettingsOptionsQuery } from "@read-aware/core";
import type { PluginSelectOption } from "@read-aware/plugin-types";
import { contributionText } from "../../features/plugins/lib/plugin-i18n";

type Source = {
  identity: object;
  version: number;
  pluginId: string;
  pluginName: string;
  current(): boolean;
  load(): Promise<PluginSelectOption[]>;
};
type Entry = { source: Source; revision: number; expires: number; pending: Promise<SettingOption[]>; settled: boolean };
const stale = () => new AppError("settings/options-stale", "Dynamic options changed or expired; restart discovery");

/** Bounded, shared result snapshots: searching/turning pages never reruns a provider. */
export class DynamicOptionsCache {
  private entries = new Map<string, Entry>();
  private revision = 0;
  private staticRevision: { host: number; options: number } | undefined;
  private active = 0;
  constructor(private readonly report: (error: unknown) => void, private readonly now = Date.now, private readonly timeoutMs = 10_000) {}

  invalidate(pluginId: string): void {
    for (const [path, entry] of this.entries) if (entry.source.pluginId === pluginId) this.entries.delete(path);
  }

  staticPage(options: SettingOption[], hostRevision: number, query: SettingsOptionsQuery) {
    if (this.staticRevision?.host !== hostRevision) this.staticRevision = { host: hostRevision, options: ++this.revision };
    return pageSettingOptions(options, this.staticRevision.options, query);
  }

  async query(query: SettingsOptionsQuery, source: Source, signal?: AbortSignal) {
    signal?.throwIfAborted();
    let entry = this.entries.get(query.path);
    if (entry && (entry.source.identity !== source.identity || entry.source.version !== source.version || !entry.source.current() || entry.expires <= this.now())) {
      this.entries.delete(query.path); entry = undefined;
    }
    if (query.revision !== undefined && query.revision !== entry?.revision) throw stale();
    if (!source.current()) throw stale();
    if (!entry) {
      if (this.active >= 4) throw new AppError("settings/options-unavailable", "Dynamic option providers are busy");
      for (const [path, cached] of this.entries) {
        if (this.entries.size < 16) break;
        if (cached.settled) this.entries.delete(path);
      }
      if (this.entries.size >= 16) throw new AppError("settings/options-unavailable", "Dynamic option cache is occupied");
      this.active++;
      let timer: ReturnType<typeof setTimeout>;
      const work = Promise.resolve().then(() => {
        signal?.throwIfAborted();
        if (!source.current()) throw stale();
        return source.load();
      }).then(options => normalizeOptions(options, source.pluginName));
      // A deadline stops waiting, not an already-dispatched callback/network request.
      void work.then(() => { this.active--; }, error => { this.active--; this.report(error); });
      const pending = Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AppError("settings/options-unavailable", "Dynamic option provider timed out")), this.timeoutMs);
      })]).finally(() => clearTimeout(timer));
      entry = { source, revision: ++this.revision, expires: this.now() + 60_000, pending, settled: false };
      this.entries.set(query.path, entry);
      const captured = entry;
      void pending.then(() => { captured.settled = true; }, () => {
        if (this.entries.get(query.path) === captured) this.entries.delete(query.path);
      });
    }
    const options = await waitForOptions(entry.pending, signal);
    if (this.entries.get(query.path) !== entry || !source.current() || entry.expires <= this.now()) throw stale();
    return pageSettingOptions(options, entry.revision, query);
  }
}

function waitForOptions<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void work.then(value => { signal.removeEventListener("abort", abort); if (signal.aborted) reject(signal.reason); else resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

function normalizeOptions(value: unknown, pluginName: string): SettingOption[] {
  const invalid = (): never => { throw new AppError("settings/options-invalid", "Invalid or excessive dynamic options"); };
  if (!Array.isArray(value) || value.length > 2000) return invalid();
  const options: SettingOption[] = [], seen = new Set<string>();
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const row of value) {
    if (!row || typeof row !== "object" || typeof row.value !== "string" || row.value.length > 512 ||
      /[\u0000-\u001f\u007f]/.test(row.value) || !(typeof row.label === "string" ||
      (row.label && typeof row.label === "object" && typeof row.label.default === "string"))) return invalid();
    const label = contributionText(row.label);
    if (typeof label !== "string" || label.length > 512 || /[\u0000-\u001f\u007f]/.test(label)) return invalid();
    bytes += encoder.encode(JSON.stringify([row.value, label])).length;
    if (bytes > 1024 * 1024) return invalid();
    if (seen.has(row.value)) continue;
    seen.add(row.value);
    options.push({ value: row.value, label, source: "plugin", pluginName });
  }
  return options;
}
