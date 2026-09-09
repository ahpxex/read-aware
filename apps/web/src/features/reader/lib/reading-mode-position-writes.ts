import { AppError, type ReadingModePosition } from "@read-aware/core";
import { ReadingModeWrites } from "./reading-mode-writes";

type Receipt = {
  id: number;
  position: ReadingModePosition | null;
  failed: boolean;
  retry(): void;
};

function samePosition(a: ReadingModePosition | null, b: ReadingModePosition | null): boolean {
  if (!a || !b) return a === b;
  return a.modeKey === b.modeKey && a.unitId === b.unitId && a.location.bookId === b.location.bookId
    && a.location.contentVersion === b.location.contentVersion && a.location.cfi === b.location.cfi;
}

/** Position failures belong to the landed unit, not every later operation in the mode. */
export class ReadingModePositionWrites {
  private revision = 0;
  private serial = 0;
  private retired = false;
  private latest: Receipt | undefined;
  private readonly writes = new ReadingModeWrites();

  start(revision: number): void {
    this.revision = revision;
    this.retired = false;
    this.latest = undefined;
    this.writes.start(++this.serial);
  }

  retire(): void {
    this.retired = true;
    this.latest = undefined;
    this.writes.start(++this.serial);
  }

  track(revision: number, position: ReadingModePosition | null, done: Promise<void>, retry: () => void): void {
    if (this.retired || revision !== this.revision) {
      void done.catch(() => {}); // The obsolete writer still owns logging its failure.
      return;
    }
    const receipt: Receipt = { id: ++this.serial, position: structuredClone(position), failed: false, retry };
    this.latest = receipt;
    this.writes.start(receipt.id);
    this.writes.track(receipt.id, done);
    void done.catch(() => { receipt.failed = true; }); // Retain failure for the next explicit retry.
  }

  retryable(): number | undefined { return this.latest?.failed ? this.latest.id : undefined; }

  async wait(revision: number, position: ReadingModePosition | null, signal: AbortSignal, retry?: number): Promise<void> {
    // Let the commit's remaining React effects register their exact position.
    await Promise.resolve();
    const check = () => {
      if (signal.aborted) throw signal.reason;
      if (this.retired || revision !== this.revision) throw new AppError("reader/superseded", "Reading mode changed during position persistence");
      if (!this.latest) {
        if (position) throw new AppError("reader/unavailable", "Reading position has no persistence receipt");
      } else if (!samePosition(position, this.latest.position)) {
        throw new AppError("reader/superseded", "A different reading position is being saved");
      }
    };
    check();
    // Only retry a failure already present when the caller started. A fresh
    // failure must reach that caller, not disappear into an automatic retry.
    if (retry !== undefined && this.latest?.id === retry) this.latest.retry();
    while (true) {
      check();
      const receipt = this.latest;
      if (!receipt) return;
      try { await this.writes.wait(receipt.id, signal); }
      catch (error) {
        if (this.latest === receipt) throw error;
        // Equivalent re-saves share a target but still require the newest receipt.
        check();
        continue;
      }
      if (this.latest === receipt) { check(); return; }
    }
  }
}
