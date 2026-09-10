/** Shared native annotation observation; the presentation remains in the view. */
import { useState } from "react";
import { useToast } from "@read-aware/ui";
import { describeError, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { useAnnotations } from "../../annotations/hooks/useAnnotations";
import type { LibraryBook } from "../../library/lib/library-types";
import { AnnotationsPopoverView } from "./AnnotationsPopoverView";

type AnnotationsPopoverProps = {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
};

const log = createLogger("annotations");

export function AnnotationsPopover({ books, onOpenBook }: AnnotationsPopoverProps) {
  const [open, setOpen] = useState(false);
  const { annotations, isLoading, loadFailed, loadErrorCode, refresh, remove } = useAnnotations(open ? { kind: "all" } : null);
  const { toast } = useToast();
  const { t } = useTranslation("reader");
  const handleDelete = async (id: string) => {
    try { await remove(id); }
    catch (error) {
      log.error("deleting annotation failed", error);
      toast({ variant: "destructive", title: t("annotations.deleteFailed"), description: describeError(error).body });
    }
  };
  return (
    <AnnotationsPopoverView
      books={books}
      annotations={annotations}
      loadFailed={loadFailed}
      loadErrorCode={loadErrorCode}
      isLoading={isLoading}
      onRetryLoad={refresh}
      open={open}
      onOpenChange={setOpen}
      onOpenBook={onOpenBook}
      onDelete={(id) => void handleDelete(id)}
    />
  );
}
