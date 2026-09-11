import { AppError, bookContextBoundaryAdmits, bookMemoryContextBundle, establishBookContextBoundary, normalizeBookContextSnapshot,
  normalizeReadingIntentScope, type BookContextBoundary, type BookContextSnapshot, type ContextBundle, type ReadingSessionSnapshot } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { getDesktopBlob } from "../platform/blob-store";
import { parseBookTextRecord, textComplete } from "../features/library/lib/book-text-record";
import { bookMemoryBoundary } from "./book-memory-boundary";
import { readingRuntime } from "./reading-runtime";

type Host = {
  read(bookId: string): Promise<unknown>;
  blob(key: string): Promise<Uint8Array | null>;
  reader: Pick<typeof readingRuntime, "snapshot" | "observe">;
};

/** Only verified persisted metadata, never a running extraction or raw book text item. */
async function chapterHrefs(source: BookContextSnapshot, host: Host, signal: AbortSignal): Promise<string[][] | null> {
  if (source.readingStatus === "finished" || source.flavor === "expository"
    || source.format === "virtual" || !source.contentHash || !source.textHash) return null;
  const loaded = await host.blob(`booktext:${source.bookId}`);
  signal.throwIfAborted();
  if (!loaded) return null;
  const bytes = new Uint8Array(loaded);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  signal.throwIfAborted();
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== source.textHash) throw new AppError("memory/conflict", "Derived text differs from captured registry hash");
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch (cause) { throw new AppError("db/error", "Invalid persisted chapter metadata", { cause }); }
  const record = parseBookTextRecord(raw, source.bookId, `sha256:${source.contentHash}`);
  // Older/incomplete/different-edition records cannot establish a chapter fence.
  return record && textComplete(record) ? record.chapters.map(chapter => [...(chapter.hrefs ?? [])]) : null;
}

/** One durable read of the book's own sources plus its verified chapter map. */
async function inspect(bookId: string, host: Host, signal: AbortSignal) {
  signal.throwIfAborted();
  const source = normalizeBookContextSnapshot(await host.read(bookId), bookId);
  signal.throwIfAborted();
  const chapters = await chapterHrefs(source, host, signal);
  signal.throwIfAborted();
  return { source, chapters };
}

/** The host-resolved fence for a captured reader state; an actor never supplies its own. */
function fence(source: BookContextSnapshot, chapters: string[][] | null, initial: ReadingSessionSnapshot) {
  const bookId = source.bookId;
  // A session-local location cannot be attached to another edition's chapter map.
  const sameSource = initial.bookId !== bookId || initial.status !== "ready"
    || initial.location?.contentVersion === `sha256:${source.contentHash}`;
  const mapped = sameSource ? chapters?.map((hrefs, index) => ({ index, hrefs })) ?? null : null;
  let boundary: BookContextBoundary = bookMemoryBoundary({ id: bookId, narrativity: source.flavor, readingStatus: source.readingStatus,
    progress: { href: source.href } }, initial, mapped);
  const href = initial.bookId === bookId ? initial.location?.href : source.href;
  if (boundary.kind === "before" && href && chapters) {
    const base = (value: string) => value.split("#")[0];
    const exact = chapters.filter(hrefs => hrefs.includes(href));
    const matches = exact.length ? exact : chapters.filter(hrefs => hrefs.some(candidate => base(candidate) === base(href)));
    if (matches.length !== 1) boundary = { kind: "unknown" };
  }
  return { boundary, chapters: mapped?.map(chapter => chapter.hrefs) ?? null };
}

function position(state: ReadingSessionSnapshot, bookId: string) {
  return JSON.stringify(state.bookId !== bookId ? null
    : [state.sessionId, state.status, state.sourceRevision ?? null, state.location?.contentVersion ?? null,
      state.location?.href ?? null, state.location?.cfi ?? null, state.location?.fraction ?? null]);
}

export function createBookContextSources(host: Host) {
  const observePosition = (bookId: string, onChange: (error: AppError) => void) => {
    const fingerprint = position(host.reader.snapshot(), bookId);
    return host.reader.observe(state => {
      if (position(state, bookId) !== fingerprint) onChange(new AppError("memory/conflict", "Book context reading position changed"));
    });
  };
  return {
    open(bookId: string, caller?: AbortSignal) {
      normalizeReadingIntentScope({ kind: "book", id: bookId });
      const initial = host.reader.snapshot(), changed = new AbortController();
      const signal = AbortSignal.any([changed.signal, ...(caller ? [caller] : [])]);
      const dispose = observePosition(bookId, error => changed.abort(error));
      return { signal, dispose,
        read: async () => {
          const { source, chapters } = await inspect(bookId, host, signal);
          const current = fence(source, chapters, initial);
          const bundle = await bookMemoryContextBundle(source, current.boundary, current.chapters);
          signal.throwIfAborted();
          return bundle;
        },
      };
    },
    /** Text of a retained version is delivered only behind a fence the current reader state still admits. */
    async disclose(bundle: ContextBundle, caller?: AbortSignal): Promise<void> {
      const scope = bundle.content.scope;
      if (bundle.content.kind !== "book_memory_context" || scope.kind !== "book") throw new AppError("memory/invalid-query", "Not a book context bundle");
      const signal = caller ?? new AbortController().signal, initial = host.reader.snapshot();
      const { source, chapters } = await inspect(scope.id, host, signal);
      const current = fence(source, chapters, initial);
      // Without a current fence there is nothing to place; otherwise the retained fence must be recovered exactly.
      if (current.boundary.kind === "all") return;
      const retained = await establishBookContextBoundary(bundle, { bookId: scope.id, flavor: source.flavor, contentHash: source.contentHash, chapters: current.chapters });
      signal.throwIfAborted();
      if (retained === null) throw new AppError("memory/forbidden", "Retained book context cannot be placed within the current edition");
      if (!bookContextBoundaryAdmits(current.boundary, retained)) throw new AppError("memory/forbidden", "Retained book context exceeds the current reading boundary");
    },
    observePosition,
  };
}

export const bookContextSources = createBookContextSources({ read: bookId => invoke("book_context_snapshot", { bookId }),
  blob: getDesktopBlob, reader: readingRuntime });
