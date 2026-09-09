import type { Api, Model } from "@earendil-works/pi-ai";
import { AppError, errorCode, type Id, type DigestReport } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import type { BookMemoryPort, BookTextPort, DigestFlavor, RuntimeDeps } from "../ports";
import { DIGEST_VERSION, extractChapterDigest, mergeCharacterRegistry } from "./chapter-digest";

export type { DigestReport } from "@read-aware/core";

export function unavailableDigestReport(reason: "boundary-unknown" | "no-toc"): DigestReport {
  return { status: "unavailable", reason, eligible: 0, attempted: 0, digested: 0, remaining: 0, emptyChapters: [], failures: [] };
}

export interface DigestMissingChaptersInput {
  bookText: Pick<BookTextPort, "getToc" | "getChapterText">;
  bookMemory: BookMemoryPort;
  complete: CompleteFn;
  model: Model<Api>;
  bookId: Id;
  beforeChapterIndex: number;
  maxChapters?: number;
  flavor?: DigestFlavor;
  concurrency?: number;
  signal?: AbortSignal;
  log?: RuntimeDeps["log"];
  onProgress?: (digested: number) => void;
  rebuild?: boolean;
  targets?: readonly number[];
  onPlan?: (chapters: number[]) => void;
  onChapterCommitted?: (chapter: number) => void;
  onReport?: (report: DigestReport) => void;
  checkChapter?: (chapter: number) => Promise<void>;
}

export function digestExecutionBudget(input: { maxChapters?: number; concurrency?: number }) {
  const max = input.maxChapters ?? 2, concurrency = input.concurrency ?? 1;
  if (!Number.isSafeInteger(max) || max < 0 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw new AppError("memory/invalid-input", "Invalid digest execution budget");
  return { max, concurrency };
}

/** One finite pass. Each selected chapter is attempted once, even after empty/failing predecessors. */
export async function digestMissingChapters(input: DigestMissingChaptersInput): Promise<DigestReport> {
  const { max, concurrency } = digestExecutionBudget(input);
  if (!Number.isSafeInteger(input.beforeChapterIndex) || input.beforeChapterIndex < 0) throw new AppError("memory/invalid-input", "Invalid digest chapter boundary");
  input.signal?.throwIfAborted();
  const [toc, existing] = await Promise.all([input.bookText.getToc(input.bookId), input.bookMemory.listDigests(input.bookId)]);
  input.signal?.throwIfAborted();
  if (!toc.length) return unavailableDigestReport("no-toc");
  const flavor = input.flavor ?? "narrative";
  const current = new Map(existing.filter(d => d.digestVersion >= DIGEST_VERSION && (d.flavor ?? "narrative") === flavor).map(d => [d.chapterIndex, d]));
  const ceiling = Math.min(input.beforeChapterIndex, toc.length), missing: number[] = [];
  const targets = input.targets && new Set(input.targets);
  for (let index = 0; index < ceiling; index++) if ((!targets || targets.has(index)) && (input.rebuild || !current.has(index))) missing.push(index);
  input.onPlan?.([...missing]);
  const selected = missing.slice(0, max);
  const report: DigestReport = { status: missing.length ? "partial" : "complete", eligible: ceiling, attempted: 0, digested: 0,
    remaining: missing.length, emptyChapters: [], failures: [] };
  const publish = () => input.onReport?.(structuredClone(report));
  publish();
  let cursor = 0, fatal: unknown, stopped = false;
  const worker = async () => {
    while (!stopped) {
      input.signal?.throwIfAborted();
      const index = selected[cursor++];
      if (index === undefined) return;
      report.attempted++;
      publish();
      try {
        await input.checkChapter?.(index);
        const snapshot = await input.bookMemory.inspectDigest(input.bookId, index, input.signal);
        input.signal?.throwIfAborted();
        if (!snapshot) throw new AppError("reader/book-not-found", "Digest book disappeared");
        if (snapshot.flavor !== flavor) throw new AppError("memory/conflict", "Book classification changed before generation");
        const text = await input.bookText.getChapterText(input.bookId, index);
        input.signal?.throwIfAborted();
        if (stopped) return;
        if (text === undefined) throw new AppError("library/content-unavailable", "Chapter text is unavailable");
        if (!text.trim()) { report.emptyChapters.push(index); continue; }
        await input.checkChapter?.(index);
        input.signal?.throwIfAborted();
        const digest = await extractChapterDigest({ complete: input.complete, model: input.model, chapterIndex: index,
          chapterHref: toc[index]?.hrefs?.[0], chapterTitle: toc[index]?.title, chapterText: text, flavor, signal: input.signal,
          // A repaired early chapter must not inherit names/aliases revealed later.
          knownCharacters: mergeCharacterRegistry([...current.values()].filter(d => d.chapterIndex < index)),
        });
        input.signal?.throwIfAborted();
        if (stopped) return;
        if (!digest) throw new AppError("ai/provider", "Nonempty chapter produced no digest");
        await input.checkChapter?.(index);
        input.signal?.throwIfAborted();
        await input.bookMemory.saveDigest(input.bookId, digest, snapshot.revision, input.signal);
        current.set(index, digest); report.digested++; report.remaining--;
        input.onChapterCommitted?.(index);
      } catch (error) {
        if (input.signal?.aborted) { stopped = true; throw error; }
        report.failures.push({ chapterIndex: index, errorCode: errorCode(error) ?? "ai/unknown" });
        input.log?.warn("chapter digest failed; remains pending", { bookId: input.bookId, chapterIndex: index, error });
        continue;
      } finally { publish(); }
      try { input.signal?.throwIfAborted(); input.onProgress?.(report.digested); }
      catch (error) { stopped = true; fatal = error; return; }
    }
  };
  // Do not declare the pass terminal while sibling reads/inference/writes are still running.
  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  input.signal?.throwIfAborted();
  if (stopped) throw fatal;
  const rejected = settled.find(r => r.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  report.emptyChapters.sort((a, b) => a - b); report.failures.sort((a, b) => a.chapterIndex - b.chapterIndex);
  report.status = report.remaining ? "partial" : "complete";
  return report;
}
