import type { HostEnvironmentSnapshot } from "@read-aware/core";

type Facts = Omit<HostEnvironmentSnapshot, "revision">;
type Listener = (snapshot: HostEnvironmentSnapshot) => void | Promise<void>;

/** One revision stream for queries and observers, with no timer when unused. */
export class HostEnvironmentStore {
  private state: HostEnvironmentSnapshot | undefined;
  private readonly listeners = new Set<Listener>();
  private unwatch: (() => void) | undefined;

  constructor(private readonly deps: {
    read(): Facts;
    watch(changed: () => void): () => void;
    report(error: unknown): void;
  }) {}

  snapshot = (): HostEnvironmentSnapshot => {
    this.refresh();
    return structuredClone(this.state!);
  };

  observe = (handler: Listener): (() => void) => {
    let revision = -1;
    const listener: Listener = state => {
      if (revision === state.revision) return;
      revision = state.revision;
      return handler(state);
    };
    if (!this.listeners.size) this.unwatch = this.deps.watch(this.refresh);
    this.listeners.add(listener);
    this.deliver(listener, this.snapshot());
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) { this.unwatch?.(); this.unwatch = undefined; }
    };
  };

  private deliver(listener: Listener, state: HostEnvironmentSnapshot): void {
    try { void Promise.resolve(listener(structuredClone(state))).catch(this.deps.report); }
    catch (error) { this.deps.report(error); }
  }

  private refresh = (): void => {
    const facts = this.deps.read();
    if (this.state && Object.entries(facts).every(([key, value]) => this.state![key as keyof Facts] === value)) return;
    this.state = { ...facts, revision: (this.state?.revision ?? 0) + 1 };
    for (const listener of [...this.listeners]) {
      if (this.listeners.has(listener)) this.deliver(listener, this.state);
    }
  };
}
