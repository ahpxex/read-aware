import { useCallback, useEffect, useState } from "react";
import { needsSpoilerProtection } from "@read-aware/agent";
import { AppError } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { userDomain } from "../../../domain";
import { describeError, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import type { LibraryBook } from "../../library/lib/library-types";

const log = createLogger("shelf");

export interface BookSpoilerProtection {
  /** Whether the assistant keeps this book's later plot from the reader. */
  enabled: boolean;
  saving: boolean;
  setEnabled(enabled: boolean): void;
}

/**
 * The reader's own say over spoiler protection for one book. Their choice is
 * written as a user classification, which the background classifier never
 * overwrites; until they choose, the shown state is the shared verdict.
 */
export function useBookSpoilerProtection(book: LibraryBook): BookSpoilerProtection {
  const { t } = useTranslation("shelf");
  const { toast } = useToast();
  const verdict = needsSpoilerProtection({
    narrativity: book.narrativity,
    spoilerSensitive: book.spoilerSensitive,
  });
  // A saved choice shows at once, before the library projection catches up.
  const [saved, setSaved] = useState<{ bookId: string; enabled: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setSaved(null), [book.id, book.spoilerSensitive]);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      setSaving(true);
      void (async () => {
        try {
          const snapshot = await userDomain.memory.queries.classification(book.id);
          if (!snapshot) throw new AppError("reader/book-not-found", "Book not found");
          await userDomain.memory.commands.classify({
            bookId: book.id,
            // Only the spoiler flag is the reader's call here; keep the digest flavor.
            narrativity: snapshot.narrativity ?? "narrative",
            spoilerSensitive: enabled,
            expectedRevision: snapshot.revision,
          });
          setSaved({ bookId: book.id, enabled });
        } catch (error) {
          log.error("saving a book's spoiler protection failed", error);
          toast({
            variant: "destructive",
            title: t("details.spoilerProtectionFailed"),
            description: describeError(error).body,
          });
        } finally {
          setSaving(false);
        }
      })();
    },
    [book.id, t, toast],
  );

  return { enabled: saved?.bookId === book.id ? saved.enabled : verdict, saving, setEnabled };
}
