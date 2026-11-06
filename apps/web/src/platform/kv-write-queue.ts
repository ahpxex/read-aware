import { actorCause, actorOrigin, causalActor, stampEventCause, type DomainActor } from "./domain-actor";
import type { EventOrigin } from "@read-aware/core";

type Mutation = { value: string | null; origin: DomainActor; done: Promise<void> };
type KeyState = { durable: string | null; mutations: Mutation[] };
export type KVWriteOrigin = "local" | "remote";
/** A caller-owned failure still rejects and is logged; its caller owns user presentation. */
export type KVFailureOwner = "store" | "caller";
export type KVCommit = {
  entries: { key: string; value: string | null }[];
  source: KVWriteOrigin | "restore";
  actor: EventOrigin | null;
};

/** Ordered durable writes with an optimistic overlay; a failed older write cannot undo a newer one. */
export class KVWriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly keys = new Map<string, KeyState>();
  get pending(): boolean {
    return this.keys.size > 0;
  }

  readDurable(key: string): string | null {
    const state = this.keys.get(key);
    return state ? state.durable : this.deps.read(key);
  }

  constructor(
    private readonly deps: {
      read(key: string): string | null;
      mirror(key: string, value: string | null, origin: DomainActor): void;
      persist(key: string, value: string | null, origin: KVWriteOrigin, actor: DomainActor): Promise<void>;
      committed(key: string, value: string | null, origin: KVWriteOrigin, actor: DomainActor): void;
      settled?(commit: KVCommit): void;
      failed(key: string, error: unknown, owner: KVFailureOwner): void;
    },
  ) {}

  write(
    key: string,
    value: string | null,
    origin: KVWriteOrigin = "local",
    actor: DomainActor | null = null,
  ): Promise<void> {
    return this.enqueue(
      new Map([[key, value]]),
      (cause) => this.deps.persist(key, value, origin, cause),
      origin,
      actor,
    );
  }

  /** Atomic user edits publish only after the entire native transaction commits. */
  batch(
    values: ReadonlyMap<string, string | null>,
    persist: (cause: DomainActor) => Promise<void>,
    actor: DomainActor | null = null,
    source: "local" | "restore" = "local",
    failureOwner: KVFailureOwner = "store",
  ): Promise<void> {
    return this.enqueue(values, persist, "local", actor, source, failureOwner);
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
    persist: (cause: DomainActor) => Promise<void>,
    origin?: KVWriteOrigin,
    actor: DomainActor | null = null,
    source: KVCommit["source"] = origin ?? "restore",
    failureOwner: KVFailureOwner = "store",
  ): Promise<void> {
    actorCause(actor ?? undefined);
    const cause = causalActor(actor ?? "system");
    const entries = [...values].map(([key, value]) => {
      const state = this.keys.get(key) ?? { durable: this.deps.read(key), mutations: [] };
      this.keys.set(key, state);
      const mutation: Mutation = { value, origin: cause, done: Promise.resolve() };
      state.mutations.push(mutation);
      return { key, value, state, mutation };
    });
    const done = this.tail.then(async () => {
      let failure: { error: unknown } | undefined;
      try {
        // Persistence and observations share one causal root, while an unknown
        // public actor remains null rather than becoming a synthetic system edit.
        await persist(cause);
        for (const { state, value } of entries) state.durable = value;
        if (origin) for (const { key, value } of entries) this.deps.committed(key, value, origin, cause);
      } catch (error) {
        failure = { error };
        throw error;
      } finally {
        for (const { key, state } of entries) {
          state.mutations.shift();
          const latest = state.mutations.at(-1);
          this.deps.mirror(key, latest ? latest.value : state.durable, latest?.origin ?? cause);
          if (!state.mutations.length) this.keys.delete(key);
        }
        if (failure) this.deps.failed(entries[0]?.key ?? "replacement", failure.error, failureOwner);
        else
          this.deps.settled?.(
            stampEventCause(
              {
                entries: entries.map(({ key, value }) => ({ key, value })),
                source,
                actor: actor === null ? null : actorOrigin(actor),
              },
              cause,
            ),
          );
      }
    });
    for (const { mutation } of entries) mutation.done = done;
    // Keep the queue usable after failures, and observe fire-and-forget facade writes.
    this.tail = done.then(
      () => {},
      () => {},
    );
    for (const { key, state } of entries) {
      // A synchronous observer may already have queued a newer mutation.
      const latest = state.mutations.at(-1)!;
      this.deps.mirror(key, latest.value, latest.origin);
    }
    return done;
  }

  /**
   * Adopt values another process (the `ra` CLI) already committed natively.
   * Queued like a write, so `load` reads after every earlier write of this
   * process persisted; a key with a write queued since keeps it, because that
   * newer local write persists afterwards and wins. Adopted values persist
   * nothing and report as `remote`, so nothing republishes them. Resolves
   * with the keys whose value changed.
   */
  reconcile(load: () => Promise<ReadonlyMap<string, string>>, known: () => Iterable<string>): Promise<string[]> {
    const done = this.tail.then(async () => {
      const fresh = await load();
      const cause = causalActor("system");
      const changed: { key: string; value: string | null }[] = [];
      for (const key of new Set([...known(), ...fresh.keys()])) {
        if (this.keys.has(key)) continue;
        const value = fresh.get(key) ?? null;
        if (this.deps.read(key) !== value) changed.push({ key, value });
      }
      for (const { key, value } of changed) {
        this.deps.mirror(key, value, cause);
        this.deps.committed(key, value, "remote", cause);
      }
      if (changed.length)
        this.deps.settled?.(stampEventCause({ entries: changed, source: "remote", actor: null }, cause));
      return changed.map(({ key }) => key);
    });
    // The queue stays usable after a failed reconcile; the returned promise
    // carries the failure to the caller, which logs it.
    this.tail = done.then(
      () => {},
      () => {},
    );
    return done;
  }

  async flush(prefix = ""): Promise<void> {
    const errors: unknown[] = [];
    while (true) {
      const pending = [...this.keys]
        .filter(([key]) => key.startsWith(prefix))
        .flatMap(([, state]) => state.mutations.map((m) => m.done));
      if (!pending.length) break;
      const results = await Promise.allSettled(pending);
      for (const result of results) if (result.status === "rejected") errors.push(result.reason);
    }
    if (errors.length) throw errors[0];
  }
}
