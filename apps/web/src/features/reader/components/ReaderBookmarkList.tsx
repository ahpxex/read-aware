import { useState } from "react";
import { BookmarkSimple, DotsThree } from "@phosphor-icons/react";
import type { Bookmark } from "@read-aware/core";
import { DropdownMenu, IconButton, InlineError, TextField, iconButtonClassName } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatDate, useTranslation } from "../../../i18n";

export type ReaderBookmarks = {
  bookmarks: Bookmark[] | null;
  failed: boolean;
  /** The chapter a bookmark is in, when its target says. */
  chapterOf?: (bookmark: Bookmark) => string | undefined;
  onAdd: () => void;
  onOpen: (bookmark: Bookmark) => void;
  onRename: (bookmark: Bookmark, name: string) => void;
  onRemove: (bookmark: Bookmark) => void;
};

/**
 * One bookmark, in the notes list's look: a marker where an annotation has
 * its color rule, the name, then chapter or date. Rename happens in place;
 * the actions sit in a menu that touch can reach too.
 */
function BookmarkRow({
  bookmark,
  chapter,
  onOpen,
  onRename,
  onRemove,
}: {
  bookmark: Bookmark;
  chapter?: string;
} & Pick<ReaderBookmarks, "onOpen" | "onRename" | "onRemove">) {
  const { t } = useTranslation("reader");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bookmark.name);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== bookmark.name) onRename(bookmark, next);
    setEditing(false);
  };
  if (editing)
    return (
      <div className="py-1 pl-2">
        <TextField
          label={t("bookmarkName")}
          hideLabel
          autoFocus
          value={draft}
          maxLength={120}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            // Keys typed into the name must not turn the page.
            event.stopPropagation();
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setDraft(bookmark.name);
              setEditing(false);
            }
          }}
        />
      </div>
    );
  return (
    <div className="group flex items-start gap-1 rounded-md transition-colors hover:bg-fg/5">
      {/* oxlint-disable-next-line react/forbid-elements -- bookmark list row that navigates to its place */}
      <button
        type="button"
        onClick={() => onOpen(bookmark)}
        className="flex min-w-0 flex-1 gap-3 rounded-md py-2 pl-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
      >
        <BookmarkSimple size={14} weight="fill" aria-hidden="true" className="mt-[3px] shrink-0 text-fg-subtle" />
        <div className="min-w-0 flex-1 font-sans">
          <p className="line-clamp-2 text-[13px] leading-relaxed text-fg">{bookmark.name}</p>
          <p className="mt-1 text-[11px] text-fg-subtle">
            {chapter ?? formatDate(new Date(bookmark.createdAt), { month: "short", day: "numeric" })}
          </p>
        </div>
      </button>
      <DropdownMenu
        // Like the notes' delete control: shown on hover or focus for a mouse,
        // always for touch.
        className="mt-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100"
        triggerLabel={t("bookmarkActions", { name: bookmark.name })}
        align="right"
        trigger={
          <span className={cn(iconButtonClassName({ size: "sm" }), "text-fg-subtle")}>
            <DotsThree size={16} weight="bold" aria-hidden="true" />
          </span>
        }
        items={[
          {
            label: t("renameBookmark"),
            onClick: () => {
              setDraft(bookmark.name);
              setEditing(true);
            },
          },
          { label: t("deleteBookmark"), destructive: true, onClick: () => onRemove(bookmark) },
        ]}
      />
    </div>
  );
}

/**
 * The book's bookmarks as the first group of the notes list: its label with
 * an add button, then one row per bookmark (oldest first).
 */
export function ReaderBookmarkSection({
  bookmarks,
  failed,
  chapterOf,
  onAdd,
  onOpen,
  onRename,
  onRemove,
}: ReaderBookmarks) {
  const { t } = useTranslation("reader");
  return (
    <div>
      <div className="sticky top-0 z-[1] flex items-center justify-between bg-[var(--ra-panel-surface,var(--ra-main-surface-color))] pl-2">
        <p className="py-1.5 font-sans text-xs font-medium text-fg-subtle">{t("bookmarksTab")}</p>
        {/* No Tooltip here: its hidden bubble is laid out beside the button and
            would widen the scrolling list. The button carries its own name. */}
        <IconButton
          size="sm"
          label={t("addBookmark")}
          title={t("addBookmark")}
          onClick={onAdd}
          className="text-fg-subtle"
          icon={<BookmarkSimple size={14} />}
        />
      </div>
      {failed ? (
        <div className="px-2 py-1">
          <InlineError compact>{t("bookmarksLoadFailed")}</InlineError>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {bookmarks?.map((bookmark) => (
            <BookmarkRow
              key={bookmark.id}
              bookmark={bookmark}
              chapter={chapterOf?.(bookmark)}
              onOpen={onOpen}
              onRename={onRename}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
