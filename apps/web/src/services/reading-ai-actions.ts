import { AppError, READING_AI_ACTIONS, type ReadingAiAction, type ReadingAiContext, type ReadingAiPort, type ReadingSessionSnapshot, type BookRangeQuery, type BookRangePage } from "@read-aware/core";

type Preferences = { features: Record<ReadingAiAction, boolean>; sendHighlightedText: boolean; sendSurroundingContext: boolean; localOnly: boolean };
type Surface = { send(context: ReadingAiContext): "loading" | "busy" | "started" };
type Host = {
  preferences(): Preferences;
  snapshot(): ReadingSessionSnapshot;
  readRange(query: BookRangeQuery, signal?: AbortSignal): Promise<BookRangePage>;
  chapter(bookId: string, href: string, signal?: AbortSignal): Promise<number | undefined>;
  prompt(action: ReadingAiAction, chapterIndex?: number): string;
  openChat(bookId: string, sessionId: string, signal?: AbortSignal): Promise<unknown>;
  observe(handler: () => void): () => void;
};
type Pending = { bookId: string; attempt(): void; reject(error: unknown): void };

/** One user action, one existing book-chat send. No hidden second inference loop. */
export class ReadingAiActions implements ReadingAiPort {
  private surfaces = new Map<string, Surface>();
  private pending?: Pending;
  constructor(private host: Host, private timeoutMs = 30_000) {}
  enabled = () => READING_AI_ACTIONS.filter(action => this.host.preferences().features[action] === true);
  private gate(action: ReadingAiAction) {
    const prefs = this.host.preferences();
    if (!READING_AI_ACTIONS.includes(action) || prefs.features[action] !== true) throw new AppError("ui/unavailable", "Reading AI action is disabled");
    if (prefs.localOnly) throw new AppError("ai/local-only", "Remote reading assistance is disabled");
    if (!(action === "summarizeChapter" ? prefs.sendSurroundingContext : prefs.sendHighlightedText)) {
      throw new AppError("ai/context-withheld", "Reading action input is withheld by privacy settings");
    }
  }
  bind(bookId: string, surface: Surface) {
    this.surfaces.set(bookId, surface); this.flush(bookId);
    return () => {
      if (this.surfaces.get(bookId) !== surface) return;
      this.surfaces.delete(bookId);
      if (this.pending?.bookId === bookId) this.pending.reject(new AppError("reader/superseded", "Book chat retired"));
    };
  }
  flush(bookId: string) { if (this.pending?.bookId === bookId) this.pending.attempt(); }
  async run(action: ReadingAiAction, answeringBookId?: string, callerSignal?: AbortSignal) {
    const invalidated = new AbortController();
    const signal = callerSignal ? AbortSignal.any([callerSignal, invalidated.signal]) : invalidated.signal;
    signal?.throwIfAborted(); this.gate(action);
    const captured = structuredClone(this.host.snapshot());
    if (captured.status !== "ready" || !captured.bookId || !captured.sessionId || !captured.location
      || answeringBookId !== undefined && answeringBookId !== captured.bookId) throw new AppError("reader/superseded", "Open the target book before using a reading action");
    const current = () => {
      signal?.throwIfAborted(); this.gate(action);
      const now = this.host.snapshot();
      if (now.status !== "ready" || now.bookId !== captured.bookId || now.sessionId !== captured.sessionId
        || now.location?.contentVersion !== captured.location?.contentVersion || now.sourceRevision !== captured.sourceRevision
        || (action === "summarizeChapter" ? now.location?.href !== captured.location?.href : JSON.stringify(now.selection) !== JSON.stringify(captured.selection))) {
        throw new AppError("reader/superseded", "Reading action target changed");
      }
    };
    // Revocation is permanent for this invocation, including an off/on while a read is pending.
    const stop = this.host.observe(() => { try { current(); } catch (error) { invalidated.abort(error); } });
    try {
    let context: ReadingAiContext;
    if (action === "summarizeChapter") {
      if (!captured.location.href) throw new AppError("reader/invalid-target", "Current chapter is unavailable");
      const index = await this.host.chapter(captured.bookId, captured.location.href, signal);
      current();
      if (index === undefined) throw new AppError("reader/invalid-target", "Current chapter could not be resolved");
      context = { action, bookId: captured.bookId, prompt: this.host.prompt(action, index) };
    } else {
      const selection = captured.selection;
      if (!selection?.text.trim()) throw new AppError("reader/invalid-target", "Select a passage first");
      let text = selection.text;
      if (selection.textLength > 32_000) throw new AppError("reader/invalid-target", "Selection exceeds the reading action limit");
      if (selection.textLength !== text.length) {
        if (!selection.range) throw new AppError("reader/invalid-target", "Complete selection is unavailable");
        text = ""; let offset = 0, total: number | undefined;
        for (;;) {
          const page = await this.host.readRange({ range: selection.range, offset, limit: 12000, contextChars: 0 }, signal);
          current();
          if (page.totalLength > 32_000 || page.totalLength < 1 || total !== undefined && total !== page.totalLength
            || JSON.stringify(page.range) !== JSON.stringify(selection.range) || page.offset !== offset
            || page.nextOffset !== null && (page.nextOffset !== offset + page.text.length || !page.text.length)) throw new AppError("reader/invalid-target", "Invalid complete selection page");
          total = page.totalLength;
          text += page.text;
          if (text.length > 32_000) throw new AppError("reader/invalid-target", "Selection exceeds the reading action limit");
          if (page.nextOffset === null) {
            if (text.length !== page.totalLength) throw new AppError("reader/invalid-target", "Incomplete selection");
            break;
          }
          offset = page.nextOffset;
        }
      }
      context = { action, bookId: captured.bookId, prompt: this.host.prompt(action), selection: {
        text, cfiRange: selection.range?.cfi ?? null, chapterHref: captured.location.href ?? null,
      } };
    }
    current();
    await this.host.openChat(captured.bookId, captured.sessionId, signal);
    current();
    if (answeringBookId !== undefined) return { status: "context" as const, context };
    if (this.pending) throw new AppError("ui/unavailable", "Another reading action is pending");
    return await new Promise<{ status: "started"; action: ReadingAiAction; bookId: string }>((resolve, reject) => {
      let done = false, attempting = false, deferredError: unknown;
      const finish = (error?: unknown) => {
        if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
        if (this.pending === pending) this.pending = undefined;
        if (error) reject(error); else resolve({ status: "started", action, bookId: context.bookId });
      };
      const cancel = (error: unknown) => { if (attempting) deferredError = error; else finish(error); };
      const abort = () => cancel(signal.reason);
      const timer = setTimeout(() => finish(new AppError("ui/unavailable", "Book chat did not become ready")), this.timeoutMs);
      const pending: Pending = { bookId: context.bookId, reject: cancel, attempt: () => {
        if (done || attempting) return;
        attempting = true;
        try {
          current();
          const outcome = this.surfaces.get(context.bookId)?.send(structuredClone(context));
          if (outcome !== "started" && deferredError) throw deferredError;
          if (outcome === "busy") finish(new AppError("ui/unavailable", "Book chat is busy"));
          if (outcome === "started") finish();
        } catch (error) { finish(error); }
        finally { attempting = false; }
      } };
      this.pending = pending;
      signal?.addEventListener("abort", abort, { once: true });
      pending.attempt();
    });
    } finally { stop(); }
  }
}
