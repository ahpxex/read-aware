/**
 * One outstanding request that waits for its effect to be confirmed (a panel
 * rendered, a surface shown, an overlay committed). Every such request follows
 * the same rules, kept here once:
 *  - one at a time per owner: a new request supersedes the outstanding one;
 *  - it settles once, with the confirmation, the caller's abort reason, or a
 *    timeout after `deadlineMs`;
 *  - a timeout or the caller's abort means "not confirmed", not "undone". An
 *    owner that keeps a desired value apart from what was rendered passes
 *    `onExpire` to return that value to the rendered one, so the next request
 *    starts from truth. Superseding never calls it: the newer intent owns the
 *    desired value.
 * What counts as confirmation stays with the owner, which calls `confirm`.
 */
export type PendingIntent<P> = {
  readonly payload: P;
  /** Distinguishes this request from a superseded one in owner callbacks. */
  readonly token: number;
  /** Aborted when the intent ends without confirmation; pass it to adapters. */
  readonly signal: AbortSignal;
};

type Entry<P, T> = PendingIntent<P> & {
  controller: AbortController;
  resolve(value: T): void;
  reject(error: unknown): void;
  cleanup(): void;
};

export class PendingIntentSlot<P, T> {
  private entry: Entry<P, T> | undefined;
  private tokens = 0;

  constructor(
    private readonly options: {
      deadlineMs: number;
      timeout(): unknown;
      superseded(): unknown;
      /** Reconcile the owner's desired value after a timeout or abort. */
      onExpire?(intent: PendingIntent<P>): void;
    },
  ) {}

  /** The outstanding intent, if any. */
  get current(): PendingIntent<P> | undefined {
    return this.entry;
  }

  /** Supersede any outstanding intent and start `payload`. The returned
   * promise settles exactly once. */
  begin(payload: P, signal?: AbortSignal): { intent: PendingIntent<P>; settled: Promise<T> } {
    this.cancel(this.options.superseded());
    const controller = new AbortController();
    let entry!: Entry<P, T>;
    const settled = new Promise<T>((resolve, reject) => {
      const expire = (reason: unknown) => {
        if (this.entry !== entry) return;
        this.cancel(reason);
        this.options.onExpire?.(entry);
      };
      const onAbort = () => expire(signal?.reason);
      const timer = setTimeout(() => expire(this.options.timeout()), this.options.deadlineMs);
      entry = {
        payload,
        token: ++this.tokens,
        signal: controller.signal,
        controller,
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        },
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    this.entry = entry;
    if (signal?.aborted) this.cancel(signal.reason);
    return { intent: entry, settled };
  }

  /** Whether `intent` is still the outstanding one. */
  holds(intent: PendingIntent<P> | undefined): boolean {
    return intent !== undefined && this.entry === intent;
  }

  /** Confirm `intent` (ignored once it was superseded or settled). */
  confirm(intent: PendingIntent<P>, value: T): void {
    if (this.entry !== intent) return;
    const entry = this.entry;
    this.entry = undefined;
    entry.cleanup();
    entry.resolve(value);
  }

  /** End the outstanding intent, if any, with `error`. */
  cancel(error: unknown): void {
    const entry = this.entry;
    if (!entry) return;
    this.entry = undefined;
    entry.cleanup();
    entry.controller.abort(error);
    entry.reject(error);
  }
}
