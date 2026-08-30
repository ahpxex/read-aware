/**
 * 跨书标注浏览的容器：标注列表的读取（每次打开时现取）与删除都在这里，
 * 弹层本身是 `AnnotationsPopoverView`。
 */
import { useCallback, useEffect, useState } from "react";
import { userDomain } from "../../../domain";
import { createLogger } from "../../../platform/logger";
import { listAnnotations } from "../../annotations/lib/annotation-db";
import type { Annotation } from "../../annotations/lib/annotation-types";
import type { LibraryBook } from "../../library/lib/library-types";
import { AnnotationsPopoverView } from "./AnnotationsPopoverView";

type AnnotationsPopoverProps = {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
};

const log = createLogger("annotations");

export function AnnotationsPopover({ books, onOpenBook }: AnnotationsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setAnnotations(await listAnnotations());
      setLoadFailed(false);
    } catch (error) {
      log.error("listing annotations failed", error);
      setAnnotations([]);
      setLoadFailed(true);
    }
  }, []);

  // Reload on every open — annotations accrue while the user reads elsewhere.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleDelete = useCallback(
    async (id: string) => {
      const target = annotations.find((a) => a.id === id);
      if (!target) return;
      if (target.type === "highlight")
        await userDomain.annotations.commands.removeHighlight(id);
      else if (target.type === "note")
        await userDomain.annotations.commands.removeNote(id);
      else await userDomain.annotations.commands.removeAsk(id);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    },
    [annotations],
  );

  return (
    <AnnotationsPopoverView
      books={books}
      annotations={annotations}
      loadFailed={loadFailed}
      onRetryLoad={() => void load()}
      open={open}
      onOpenChange={setOpen}
      onOpenBook={onOpenBook}
      onDelete={(id) => void handleDelete(id)}
    />
  );
}
