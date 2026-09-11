import { useEffect, useRef } from "react";
import { isTauri } from "../../../platform/environment";
import {
  onExternalOpenRequest,
  isExternalOpenBatchCurrent,
  sourcesFromNativePaths,
  takeExternalOpenPaths,
} from "../lib/external-open";
import type { BookImportSource, LibraryBook } from "../lib/library-types";
import type { ImportOutcome } from "./useLibraryController";
import { createLogger } from "../../../platform/logger";

const log = createLogger("external-book-opens");

type ExternalBookOpensOptions = {
  /**
   * Gate: the import dedupe reads the loaded shelf, so draining before the
   * library finished loading would re-import books it cannot see yet.
   */
  enabled: boolean;
  importSources: (sources: BookImportSource[]) => Promise<ImportOutcome[]>;
  openBook: (book: LibraryBook) => void;
  reportError: (error: unknown) => void;
};

/**
 * OS "open with ReadAware" requests: drain the Rust-parked path queue once on
 * mount and again on every ping, run each batch through the normal import
 * pipeline (a duplicate resolves to the existing shelf book), then open the
 * batch's last book in the reader — double-clicking a book file means "read
 * this now", not just "add it to the shelf".
 */
export function useExternalBookOpens({
  enabled,
  importSources,
  openBook,
  reportError,
}: ExternalBookOpensOptions): void {
  // Latest callbacks behind refs so the Tauri subscription mounts once.
  const importRef = useRef(importSources);
  importRef.current = importSources;
  const openRef = useRef(openBook);
  openRef.current = openBook;
  const reportRef = useRef(reportError);
  reportRef.current = reportError;

  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let disposed = false;
    let draining = false;
    let pinged = false;

    async function drain() {
      if (disposed) return;
      // A ping during a drain marks a re-run instead of racing the importer:
      // two concurrent drains would both read the shelf before either commits,
      // letting the same file land twice.
      if (draining) {
        pinged = true;
        return;
      }
      draining = true;
      try {
        do {
          pinged = false;
          const batch = await takeExternalOpenPaths();
          if (disposed || batch.paths.length === 0) continue;
          const sources = await sourcesFromNativePaths(batch.paths, batch.epoch);
          if (disposed) continue;
          if (!(await isExternalOpenBatchCurrent(batch)) || disposed) continue;
          const outcomes = await importRef.current(sources);
          if (disposed || outcomes.length === 0) continue;
          if (!(await isExternalOpenBatchCurrent(batch)) || disposed) continue;
          openRef.current(outcomes[outcomes.length - 1].book);
        } while (pinged && !disposed);
      } catch (error) {
        log.error("Processing external file requests failed", error);
        if (!disposed) reportRef.current(error);
      } finally {
        draining = false;
        if (pinged && !disposed) void drain();
      }
    }

    const dispose = onExternalOpenRequest(() => void drain(), error => reportRef.current(error));
    // StrictMode's abandoned mount must not consume the native cold-start queue.
    queueMicrotask(() => { if (!disposed) void drain(); });
    return () => {
      disposed = true;
      dispose();
    };
  }, [enabled]);
}
