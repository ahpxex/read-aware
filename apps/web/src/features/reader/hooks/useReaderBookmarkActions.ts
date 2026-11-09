import { useCallback, useMemo } from "react";
import { bookmarkLocation, type Bookmark } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { describeError, useTranslation } from "../../../i18n";
import { removeBookmark, renameBookmark } from "../../../domain/bookmarks";
import { createLogger } from "../../../platform/logger";
import { bookmarkReadingPosition, goToReadingTarget } from "../lib/reader-bookmarks";

const log = createLogger("reader-bookmarks");

/** Bookmark commands with the reader's feedback: a toast for every outcome. */
export function useReaderBookmarkActions(defaultName?: string) {
  const { toast } = useToast();
  const { t } = useTranslation("reader");
  const fail = useCallback(
    (message: string, error: unknown) => {
      log.error(message, error);
      toast({ variant: "destructive", description: describeError(error).body });
    },
    [toast],
  );
  const add = useCallback(async () => {
    try {
      await bookmarkReadingPosition(defaultName);
      toast({ description: t("bookmarkAdded") });
    } catch (error) {
      fail("adding a bookmark failed", error);
    }
  }, [defaultName, fail, t, toast]);
  const rename = useCallback(
    async (bookmark: Bookmark, name: string) => {
      try {
        await renameBookmark(bookmark, name, "user");
      } catch (error) {
        fail("renaming a bookmark failed", error);
      }
    },
    [fail],
  );
  const remove = useCallback(
    async (bookmark: Bookmark) => {
      try {
        await removeBookmark(bookmark, "user");
        toast({ description: t("bookmarkRemoved") });
      } catch (error) {
        fail("removing a bookmark failed", error);
      }
    },
    [fail, t, toast],
  );
  /** Resolves true once the reader has moved. */
  const open = useCallback(
    async (bookmark: Bookmark) => {
      try {
        await goToReadingTarget(bookmarkLocation(bookmark));
        return true;
      } catch (error) {
        fail("opening a bookmark failed", error);
        return false;
      }
    },
    [fail],
  );
  return useMemo(() => ({ add, rename, remove, open }), [add, rename, remove, open]);
}
