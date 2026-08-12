import { useEffect, useRef } from "react";
import { isTauri } from "../../../platform/environment";
import {
  onExternalOpenRequest,
  sourcesFromNativePaths,
  takeExternalOpenPaths,
} from "../lib/external-open";
import type { BookImportSource, LibraryBook } from "../lib/library-types";
import type { ImportOutcome } from "./useLibraryController";

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
          const paths = await takeExternalOpenPaths();
          if (disposed || paths.length === 0) continue;
          const outcomes = await importRef.current(await sourcesFromNativePaths(paths));
          if (disposed || outcomes.length === 0) continue;
          openRef.current(outcomes[outcomes.length - 1].book);
        } while (pinged && !disposed);
      } catch (error) {
        reportRef.current(error);
      } finally {
        draining = false;
      }
    }

    const dispose = onExternalOpenRequest(() => void drain());
    void drain();
    return () => {
      disposed = true;
      dispose();
    };
  }, [enabled]);
}
