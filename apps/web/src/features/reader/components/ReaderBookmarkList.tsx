import { useState } from "react";
import { BookmarkSimple, DotsThree } from "@phosphor-icons/react";
import type { Bookmark } from "@read-aware/core";
import { DropdownMenu, TextField, iconButtonClassName } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatDate, useTranslation } from "../../../i18n";

export type ReaderBookmarks = {
  bookmarks: Bookmark[] | null;
  failed: boolean;
  onOpen: (bookmark: Bookmark) => void;
  onRename: (bookmark: Bookmark, name: string) => void;
  onRemove: (bookmark: Bookmark) => void;
};

/**
 * One bookmark among the notes list's marks: a bookmark glyph where an
 * annotation has its color rule, the name, then the date. Rename happens in
 * place; the actions sit in a menu that touch can reach too.
 */
export function BookmarkRow({
  bookmark,
  onOpen,
  onRename,
  onRemove,
}: {
  bookmark: Bookmark;
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
    <div className="group relative rounded-md transition-colors hover:bg-fg/5">
      {/* oxlint-disable-next-line react/forbid-elements -- bookmark list row that navigates to its place */}
      <button
        type="button"
        onClick={() => onOpen(bookmark)}
        className="flex w-full min-w-0 gap-3 rounded-md px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
      >
        <BookmarkSimple size={14} weight="fill" aria-hidden="true" className="mt-[3px] shrink-0 text-fg-subtle" />
        <div className="min-w-0 flex-1 font-sans">
          <p className="line-clamp-2 text-[13px] leading-relaxed text-fg">{bookmark.name}</p>
          <p className="mt-1 text-[11px] text-fg-subtle">
            {formatDate(new Date(bookmark.createdAt), { month: "short", day: "numeric" })}
          </p>
        </div>
      </button>
      <DropdownMenu
        // Like the notes' delete control: on the date line's right end, shown
        // on hover or focus for a mouse and always for touch.
        className="absolute right-1 bottom-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100"
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
