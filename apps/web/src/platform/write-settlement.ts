/** Tracks dispatched durable writes so shutdown can wait for their real receipts.
 * Tracking never changes an outcome: a tracked failure still rejects its caller. */
export class WriteSettlement {
  private readonly pending = new Set<Promise<unknown>>();

  track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work);
    const done = () => { this.pending.delete(work); };
    work.then(done, done);
    return work;
  }

  get size(): number { return this.pending.size; }

  /** Resolves once every write dispatched before the call has settled, including writes
   * dispatched meanwhile; a failed write does not fail settlement. */
  async settle(signal?: AbortSignal): Promise<void> {
    while (this.pending.size) {
      signal?.throwIfAborted();
      await Promise.allSettled([...this.pending]);
    }
  }
}

export const durableWrites = new WriteSettlement();
