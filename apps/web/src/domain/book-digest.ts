import type { DomainActor } from "../platform/domain-actor";
import { getBookContentState } from "./book-content-state";
import { getVirtualTextSource } from "../features/library/lib/virtual-text-source";
import { runDomainWrite } from "../platform/domain-write-gate";
import {
  AppError,
  ERR_EVENT_HLC_CONFLICT,
  errorCode,
  validateClassificationBookId,
  type BookDigestSnapshot,
  type ChapterDigest,
} from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { isTauri } from "../platform/environment";
import {
  broadcastDomainEventDrafts,
  dispatchMinted,
  mintEventRows,
  type DomainEventDraft,
} from "../platform/domain-events";

function assertLive(signal?: AbortSignal) {
  if (!isTauri()) throw new AppError("memory/unavailable", "Digest storage requires desktop");
  if (signal?.aborted) throw new AppError("memory/cancelled", "Digest owner cancelled");
}
function validateTarget(bookId: string, chapterIndex: number) {
  validateClassificationBookId(bookId);
  if (!Number.isSafeInteger(chapterIndex) || chapterIndex < 0)
    throw new AppError("memory/invalid-input", "Invalid digest chapter");
}
/** Resolves actual virtual content, not merely a registered provider identity. */
export async function getDigestContentVersion(
  bookId: string,
  signal?: AbortSignal,
  loadVirtual = false,
): Promise<string> {
  const before = await getBookContentState(bookId, signal);
  const version =
    before.source === "virtual"
      ? (await getVirtualTextSource(bookId, loadVirtual)).contentVersion
      : before.contentVersion;
  const after = await getBookContentState(bookId, signal);
  if (before.sourceRevision !== after.sourceRevision || before.source !== after.source)
    throw new AppError("memory/conflict", "Digest source changed during discovery");
  if (!version) throw new AppError("library/content-unavailable", "Digest source has no current content identity");
  return version;
}

export async function inspectBookDigest(
  bookId: string,
  chapterIndex: number,
  signal?: AbortSignal,
): Promise<BookDigestSnapshot | null> {
  validateTarget(bookId, chapterIndex);
  assertLive(signal);
  const snapshot = await invoke<BookDigestSnapshot | null>("book_digest_inspect", { id: bookId, chapterIndex });
  if (!snapshot) return null;
  const contentVersion = await getDigestContentVersion(bookId, signal);
  if (snapshot.contentVersion && snapshot.contentVersion !== contentVersion)
    throw new AppError("memory/conflict", "Digest source changed during inspection");
  assertLive(signal);
  return { ...snapshot, contentVersion };
}
export async function saveBookDigest(
  bookId: string,
  digest: ChapterDigest,
  expectedRevision: string,
  signal?: AbortSignal,
  origin: DomainActor = "agent",
): Promise<void> {
  validateTarget(bookId, digest.chapterIndex);
  if (typeof expectedRevision !== "string" || !/^bdg1:[a-f0-9]{64}$/.test(expectedRevision))
    throw new AppError("memory/invalid-input", "Missing digest revision");
  const copy = structuredClone(digest);
  const checkSource = async () => {
    if (!copy.contentVersion || (await getDigestContentVersion(bookId, signal)) !== copy.contentVersion)
      throw new AppError("memory/conflict", "Digest source changed before commit");
  };
  const draft: DomainEventDraft = {
    type: "book.chapterDigested",
    origin,
    payload: { ...copy, bookId, flavor: copy.flavor ?? "narrative" },
  };
  return runDomainWrite(async () => {
    assertLive(signal);
    // Admission must precede the source recheck. During backup capture a
    // conditional write is rejected before it can read native state or mint an
    // event, just like every other domain writer.
    await checkSource();
    await dispatchMinted([draft], async ([event]) => {
      assertLive(signal);
      await checkSource();
      return invoke<BookDigestSnapshot>("book_digest_commit", { event, expectedRevision });
    });
    broadcastDomainEventDrafts([draft]);
  });
}

/** Host-private prepared write, stored before native dispatch by durable jobs. */
export type DurableDigestWrite = {
  bookId: string;
  digest: ChapterDigest;
  expectedRevision: string;
  event: Awaited<ReturnType<typeof mintEventRows>>[number];
};
export async function prepareDurableDigestWrite(
  bookId: string,
  digest: ChapterDigest,
  expectedRevision: string,
  signal: AbortSignal | undefined,
  origin: DomainActor,
): Promise<DurableDigestWrite> {
  validateTarget(bookId, digest.chapterIndex);
  assertLive(signal);
  const copy = structuredClone(digest);
  if (!copy.contentVersion || (await getDigestContentVersion(bookId, signal)) !== copy.contentVersion)
    throw new AppError("memory/conflict", "Digest source changed before preparation");
  const [event] = await mintEventRows([
    { type: "book.chapterDigested", origin, payload: { ...copy, bookId, flavor: copy.flavor ?? "narrative" } },
  ]);
  assertLive(signal);
  return { bookId, digest: copy, expectedRevision, event: event! };
}
export async function durableDigestReceipt(write: DurableDigestWrite): Promise<boolean> {
  return invoke("book_digest_receipt", { event: write.event });
}
export async function commitDurableDigestWrite(
  write: DurableDigestWrite,
  signal: AbortSignal | undefined,
  origin: DomainActor,
): Promise<void> {
  const copy = structuredClone(write);
  if (await durableDigestReceipt(copy)) return;
  await runDomainWrite(async () => {
    assertLive(signal);
    if ((await getDigestContentVersion(copy.bookId, signal)) !== copy.digest.contentVersion)
      throw new AppError("memory/conflict", "Digest source changed before commit");
    try {
      await invoke("book_digest_commit", { event: copy.event, expectedRevision: copy.expectedRevision });
    } catch (error) {
      if (errorCode(error) === ERR_EVENT_HLC_CONFLICT) {
        // The prepared stamp was taken by another ReadAware process on this
        // device (the CLI) before this write landed; nothing was written.
        // Commit the same digest under fresh stamps. A lost reply to this
        // re-mint cannot be matched by the prepared event's receipt, so a
        // later retry would stop at the revision check instead of writing a
        // second digest.
        await dispatchMinted(
          [
            {
              type: "book.chapterDigested",
              origin,
              payload: { ...copy.digest, bookId: copy.bookId, flavor: copy.digest.flavor ?? "narrative" },
            },
          ],
          ([event]) => invoke("book_digest_commit", { event, expectedRevision: copy.expectedRevision }),
        );
      } else if (!(await durableDigestReceipt(copy))) {
        // A concurrent retry or a lost reply may have committed this exact event.
        throw error;
      }
    }
    broadcastDomainEventDrafts([
      {
        type: "book.chapterDigested",
        origin,
        payload: { ...copy.digest, bookId: copy.bookId, flavor: copy.digest.flavor ?? "narrative" },
      },
    ]);
  });
}
