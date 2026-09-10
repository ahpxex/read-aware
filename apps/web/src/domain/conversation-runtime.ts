import { AppError, type ConversationSessionState, type ConversationTarget } from "@read-aware/core";

/** Shared ownership of live UI turns. Clearing waits for their final persistence. */
export class ConversationRuntime {
  private sessions = new Map<string, ConversationSessionState>();
  private flights = new Map<string, Set<{ abort(): void; done: Promise<void> }>>();
  private blocked = new Set<string>();
  private listeners = new Set<() => void>();
  revision = 0;
  constructor(private report: (error: unknown) => void) {}
  snapshot() { return [...this.sessions.values()].map(state => ({ ...state })); }
  observe(handler: () => void) { this.listeners.add(handler); return () => { this.listeners.delete(handler); }; }
  changed() {
    this.revision++;
    for (const handler of this.listeners) { try { handler(); } catch (error) { this.report(error); } }
  }
  bind(target: ConversationTarget) {
    const state = { ...target, sessionId: crypto.randomUUID(), loading: true, streaming: false, messageCount: 0 };
    this.sessions.set(target.id, state); this.changed();
    return {
      update: (next: Pick<ConversationSessionState, "loading" | "streaming" | "messageCount">) => {
        if (this.sessions.get(target.id) !== state) return;
        if (state.loading === next.loading && state.streaming === next.streaming && state.messageCount === next.messageCount) return;
        Object.assign(state, next); this.changed();
      },
      dispose: () => { if (this.sessions.get(target.id) === state) { this.sessions.delete(target.id); this.changed(); } },
    };
  }
  canStart(id: string) { return !this.blocked.has(id) && !this.flights.get(id)?.size; }
  track(id: string, abort: () => void, done: Promise<void>) {
    const set = this.flights.get(id) ?? new Set(), flight = { abort, done };
    set.add(flight); this.flights.set(id, set);
    const release = () => { set.delete(flight); if (!set.size) this.flights.delete(id); };
    void done.then(release, error => { release(); this.report(error); });
  }
  async quiesce<T>(id: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.blocked.has(id)) throw new AppError("ui/unavailable", "Conversation control is already in progress");
    this.blocked.add(id);
    try {
      const flights = [...this.flights.get(id) ?? []];
      for (const flight of flights) flight.abort();
      await Promise.all(flights.map(flight => flight.done));
      signal?.throwIfAborted(); return await action();
    } finally { this.blocked.delete(id); this.changed(); }
  }
}
