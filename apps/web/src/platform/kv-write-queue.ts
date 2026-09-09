type Mutation = { value: string | null; done: Promise<void> };
type KeyState = { durable: string | null; mutations: Mutation[] };
export type KVWriteOrigin = "local" | "remote";

/** Ordered durable writes with an optimistic overlay; a failed older write cannot undo a newer one. */
export class KVWriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly keys = new Map<string, KeyState>();

  constructor(private readonly deps: {
    read(key: string): string | null;
    mirror(key: string, value: string | null): void;
    persist(key: string, value: string | null): Promise<void>;
    committed(key: string, value: string | null, origin: KVWriteOrigin): void;
    failed(key: string, error: unknown): void;
  }) {}

  write(key: string, value: string | null, origin: KVWriteOrigin = "local"): Promise<void> {
    return this.enqueue(new Map([[key, value]]), () => this.deps.persist(key, value), origin);
  }

  /** Atomic user edits publish only after the entire native transaction commits. */
  batch(values: ReadonlyMap<string, string | null>, persist: () => Promise<void>): Promise<void> {
    return this.enqueue(values, persist, "local");
  }

  /** Invoke without a microtask gap between the settled-state check and the read/enqueue. */
  async afterPending<T>(operation: () => T | Promise<T>): Promise<T> {
    while (true) {
      const predecessor = this.tail;
      await predecessor;
      if (predecessor === this.tail) return operation();
    }
  }

  /** A native atomic replacement shares the same ordering and optimistic overlay as single writes. */
  replace(values: ReadonlyMap<string, string | null>, persist: () => Promise<void>): Promise<void> {
    // Restoration is not a new user edit and must not republish roaming events.
    return this.enqueue(values, persist);
  }

  private enqueue(
    values: ReadonlyMap<string, string | null>,
    persist: () => Promise<void>,
    origin?: KVWriteOrigin,
  ): Promise<void> {
    const entries = [...values].map(([key, value]) => {
      const state = this.keys.get(key) ?? { durable: this.deps.read(key), mutations: [] };
      this.keys.set(key, state);
      const mutation: Mutation = { value, done: Promise.resolve() };
      state.mutations.push(mutation);
      return { key, value, state, mutation };
    });
    const done = this.tail.then(async () => {
      let failure: { error: unknown } | undefined;
      try {
        await persist();
        for (const { state, value } of entries) state.durable = value;
        if (origin) for (const { key, value } of entries) this.deps.committed(key, value, origin);
      } catch (error) {
        failure = { error };
        throw error;
      } finally {
        for (const { key, state } of entries) {
          state.mutations.shift();
          const latest = state.mutations.at(-1);
          this.deps.mirror(key, latest ? latest.value : state.durable);
          if (!state.mutations.length) this.keys.delete(key);
        }
        if (failure) this.deps.failed(entries[0]?.key ?? "replacement", failure.error);
      }
    });
    for (const { mutation } of entries) mutation.done = done;
    // Keep the queue usable after failures, and observe fire-and-forget facade writes.
    this.tail = done.then(() => {}, () => {});
    for (const { key, state } of entries) {
      // A synchronous observer may already have queued a newer mutation.
      this.deps.mirror(key, state.mutations.at(-1)!.value);
    }
    return done;
  }

  async flush(prefix = ""): Promise<void> {
    const errors: unknown[] = [];
    while (true) {
      const pending = [...this.keys].filter(([key]) => key.startsWith(prefix)).flatMap(([, state]) => state.mutations.map(m => m.done));
      if (!pending.length) break;
      const results = await Promise.allSettled(pending);
      for (const result of results) if (result.status === "rejected") errors.push(result.reason);
    }
    if (errors.length) throw errors[0];
  }
}
