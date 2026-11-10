/**
 * The leases behind prepared book content (see book-content-source.ts for
 * what preparing a book is and who uses it).
 *
 * One preparation per book content, shared by every lease on it:
 *
 * - The first lease starts the preparation; the others join it.
 * - A released book whose content is kept (`keepIdle`) stays prepared, the
 *   most recently used few, so asking again does not prepare it again.
 * - Content that is no longer the book's — another identity, another file
 *   under the same id, an explicit `retire` — is replaced for new leases.
 *   Whoever still holds the earlier preparation keeps a working book until
 *   they release it; it is closed with its last lease.
 *
 * The cache owns one claim on each prepared book and every lease owns
 * another (`retain`), so the book is closed exactly when nobody has it.
 */

export type PreparedContent<Book, Identity> = { book: Book; contentVersion: string; identity: Identity };

export type ContentLease<Book, Identity> = {
  content: PreparedContent<Book, Identity>;
  /** Give the lease back. Idempotent. */
  release(): Promise<void>;
};

export type BookContentCacheDependencies<Book, Identity> = {
  /** What the book's content is made from right now. Leases of equal identities share a preparation. */
  identity(bookId: string): Identity;
  sameIdentity(a: Identity, b: Identity): boolean;
  /** Whether a released preparation of this identity may be kept for the next lease. */
  keepIdle(identity: Identity): boolean;
  /** The version of the content a kept preparation must still match, or null when it cannot be told. */
  currentVersion(bookId: string, identity: Identity): Promise<string | null>;
  /** `fetchMissing`: whether the preparation may bring missing content from elsewhere. */
  prepare(bookId: string, identity: Identity, fetchMissing: boolean): Promise<{ book: Book; contentVersion: string }>;
  /** Claim the book; the returned function gives the claim back, and the last one closes the book. */
  retain(book: Book): () => Promise<void>;
  warn(message: string, error: unknown): void;
};

type Entry<Book, Identity> = {
  bookId: string;
  identity: Identity;
  ready: Promise<PreparedContent<Book, Identity>>;
  /** Set once prepared. */
  content?: PreparedContent<Book, Identity>;
  /** The cache's own claim on the book, given back when the entry is dropped. */
  hold?: () => Promise<void>;
  leases: number;
  /** No longer what a new lease on this book gets; dropped with its last lease. */
  retired: boolean;
  dropped: boolean;
  /** Content handed in from outside (see `adopt`): never the cache's to close or keep. */
  adopted: boolean;
  fetchMissing: boolean;
};

export class BookContentCache<Book, Identity> {
  private readonly current = new Map<string, Entry<Book, Identity>>();
  /** Released entries still prepared, most recently used last. */
  private readonly idle: Entry<Book, Identity>[] = [];

  constructor(
    private readonly deps: BookContentCacheDependencies<Book, Identity>,
    private readonly keptIdle = 2,
  ) {}

  private drop(entry: Entry<Book, Identity>): void {
    if (entry.dropped) return;
    entry.dropped = true;
    if (this.current.get(entry.bookId) === entry) this.current.delete(entry.bookId);
    const at = this.idle.indexOf(entry);
    if (at >= 0) this.idle.splice(at, 1);
    const hold = entry.hold;
    entry.hold = undefined;
    if (hold) void hold().catch((error: unknown) => this.deps.warn("Could not close a prepared book", error));
  }

  private retireEntry(entry: Entry<Book, Identity>): void {
    entry.retired = true;
    if (this.current.get(entry.bookId) === entry) this.current.delete(entry.bookId);
    if (entry.leases === 0) this.drop(entry);
  }

  private claim(entry: Entry<Book, Identity>): void {
    entry.leases++;
    const at = this.idle.indexOf(entry);
    if (at >= 0) this.idle.splice(at, 1);
  }

  private settle(entry: Entry<Book, Identity>): void {
    if (entry.leases > 0 || entry.dropped) return;
    if (entry.retired || entry.adopted || !entry.content || !this.deps.keepIdle(entry.identity)) {
      this.drop(entry);
      return;
    }
    this.idle.push(entry);
    while (this.idle.length > this.keptIdle) this.drop(this.idle[0]!);
  }

  private create(bookId: string, identity: Identity, fetchMissing: boolean): Entry<Book, Identity> {
    const entry: Entry<Book, Identity> = {
      bookId,
      identity,
      ready: this.deps.prepare(bookId, identity, fetchMissing).then((prepared) => ({ ...prepared, identity })),
      leases: 0,
      retired: false,
      dropped: false,
      adopted: false,
      fetchMissing,
    };
    entry.ready.then(
      (content) => {
        entry.content = content;
        const hold = this.deps.retain(content.book);
        // Given up while it was being prepared: close what was just made.
        if (entry.dropped)
          void hold().catch((error: unknown) => this.deps.warn("Could not close a prepared book", error));
        else entry.hold = hold;
      },
      () => {
        // A failed preparation is not kept: the next request tries again.
        entry.retired = true;
        if (this.current.get(bookId) === entry) this.current.delete(bookId);
      },
    );
    this.current.set(bookId, entry);
    return entry;
  }

  /** Stop handing the book's present content to new leases (it was removed, replaced or invalidated). */
  retire(bookId: string): void {
    const entry = this.current.get(bookId);
    if (entry) this.retireEntry(entry);
  }

  /** Lease the book's prepared content, preparing it if nobody has. */
  async acquire(
    bookId: string,
    options: { fetchMissing?: boolean; signal?: AbortSignal } = {},
  ): Promise<ContentLease<Book, Identity>> {
    const { fetchMissing = false, signal } = options;
    signal?.throwIfAborted();
    const identity = this.deps.identity(bookId);

    let entry = this.current.get(bookId);
    if (entry && !this.deps.sameIdentity(entry.identity, identity)) {
      this.retireEntry(entry);
      entry = undefined;
    }
    // A preparation that may not fetch cannot answer one that may: content
    // that is not here fails the first and must not fail the second with it.
    if (entry && fetchMissing && !entry.fetchMissing && !entry.content) {
      this.retireEntry(entry);
      entry = undefined;
    }
    // A kept book whose content was replaced under the same id is another
    // content. One in use is left to its holders, who make their own checks.
    // It is claimed while it is checked, so a release elsewhere cannot push
    // it out of the kept ones in the meantime.
    let claimed = false;
    if (entry && !entry.adopted && entry.leases === 0 && entry.content) {
      const kept = entry;
      this.claim(kept);
      // A version that cannot be read is not the kept one's: prepare again and let that report why.
      const version = await this.deps.currentVersion(bookId, kept.identity).catch(() => null);
      if (version !== kept.content?.contentVersion) this.retireEntry(kept);
      if (signal?.aborted || kept.retired) {
        kept.leases--;
        this.settle(kept);
        signal?.throwIfAborted();
        // The book's content changed while it was checked: start over with what it is now.
        return this.acquire(bookId, options);
      }
      claimed = true;
    }
    entry ??= this.create(bookId, identity, fetchMissing);
    if (!claimed) this.claim(entry);

    const held = entry;
    let unretain: (() => Promise<void>) | undefined;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      try {
        await unretain?.();
      } finally {
        held.leases--;
        this.settle(held);
      }
    };
    try {
      const content = await held.ready;
      signal?.throwIfAborted();
      unretain = this.deps.retain(content.book);
      return { content, release };
    } catch (error) {
      await release();
      throw error;
    }
  }

  /**
   * Make an already prepared book this book's content until the returned
   * function is called. The caller keeps owning the book.
   */
  adopt(bookId: string, book: Book, contentVersion: string, identity: Identity): () => void {
    this.retire(bookId);
    const content = { book, contentVersion, identity };
    const entry: Entry<Book, Identity> = {
      bookId,
      identity,
      ready: Promise.resolve(content),
      content,
      leases: 1,
      retired: false,
      dropped: false,
      adopted: true,
      fetchMissing: false,
    };
    this.current.set(bookId, entry);
    let adopted = true;
    return () => {
      if (!adopted) return;
      adopted = false;
      entry.leases--;
      this.retireEntry(entry);
    };
  }
}
