import { Plus } from "@phosphor-icons/react";
import { IconButton, Tooltip } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { LibraryBook } from "../../library/lib/library-types";
import { contextHeaderActionClass } from "../lib/context-header-action";
import { AnnotationsPopover } from "./AnnotationsPopover";
import { ThreadsPopover } from "./ThreadsPopover";

export function ContextHeaderActions({
  books,
  onOpenBook,
  onNewConversation,
}: {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
  onNewConversation: () => void;
}) {
  const { t } = useTranslation("ai");

  return (
    <>
      <Tooltip content={t("context.threads.new")} side="bottom">
        <IconButton
          size="sm"
          label={t("context.threads.new")}
          onClick={onNewConversation}
          className={contextHeaderActionClass}
          icon={<Plus size={16} weight="regular" aria-hidden="true" />}
        />
      </Tooltip>
      <ThreadsPopover />
      <AnnotationsPopover books={books} onOpenBook={onOpenBook} />
    </>
  );
}
