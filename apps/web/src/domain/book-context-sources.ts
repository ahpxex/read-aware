import { AppError, bookMemoryContextBundle, normalizeBookContextSnapshot, normalizeReadingIntentScope,
  type BookContextSnapshot, type ReadingSessionSnapshot } from "@read-aware/core";
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

export function createBookContextSources(host: Host) {
  return {
    open(bookId: string, caller?: AbortSignal) {
      normalizeReadingIntentScope({ kind: "book", id: bookId });
      const initial = host.reader.snapshot(), changed = new AbortController();
      const signal = AbortSignal.any([changed.signal, ...(caller ? [caller] : [])]);
      const position = (state: ReadingSessionSnapshot) => state.bookId !== bookId ? null
        : [state.sessionId, state.status, state.sourceRevision ?? null, state.location?.contentVersion ?? null,
          state.location?.href ?? null, state.location?.cfi ?? null, state.location?.fraction ?? null];
      const fingerprint = JSON.stringify(position(initial));
      const dispose = host.reader.observe(state => {
        if (JSON.stringify(position(state)) !== fingerprint) changed.abort(new AppError("memory/conflict", "Book context reading position changed"));
      });
      return { signal, dispose,
        read: async () => {
          signal.throwIfAborted();
          const source = normalizeBookContextSnapshot(await host.read(bookId), bookId);
          signal.throwIfAborted();
          const chapters = await chapterHrefs(source, host, signal);
          signal.throwIfAborted();
          // A session-local location cannot be attached to another edition's chapter map.
          const sameSource = initial.bookId !== bookId || initial.status !== "ready"
            || initial.location?.contentVersion === `sha256:${source.contentHash}`;
          const mapped = sameSource ? chapters?.map((hrefs, index) => ({ index, hrefs })) ?? null : null;
          let boundary = bookMemoryBoundary({ id: bookId, narrativity: source.flavor, readingStatus: source.readingStatus,
            progress: { href: source.href } }, initial, mapped);
          const href = initial.bookId === bookId ? initial.location?.href : source.href;
          if (boundary.kind === "before" && href && chapters) {
            const base = (value: string) => value.split("#")[0];
            const exact = chapters.filter(hrefs => hrefs.includes(href));
            const matches = exact.length ? exact : chapters.filter(hrefs => hrefs.some(candidate => base(candidate) === base(href)));
            if (matches.length !== 1) boundary = { kind: "unknown" };
          }
          const bundle = await bookMemoryContextBundle(source, boundary, mapped?.map(chapter => chapter.hrefs) ?? null);
          signal.throwIfAborted();
          return bundle;
        },
      };
    },
  };
}

export const bookContextSources = createBookContextSources({ read: bookId => invoke("book_context_snapshot", { bookId }),
  blob: getDesktopBlob, reader: readingRuntime });
