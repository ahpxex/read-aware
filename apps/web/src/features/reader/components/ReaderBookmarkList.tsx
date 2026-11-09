import { useState } from "react";
import type { Bookmark } from "@read-aware/core";
import { DotsThree } from "@phosphor-icons/react";
import { Body, Caption, DropdownMenu, InlineError, Spinner, TextField, iconButtonClassName } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatDate, useTranslation } from "../../../i18n";

/** The row look shared with the contents list: edge to edge, inset text. */
export const CONTENTS_ROW =
  "w-full border-l-2 border-transparent py-1.5 pr-3 pl-7 text-left text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg";

function BookmarkRow({
  bookmark,
  subtitle,
  onOpen,
  onRename,
  onRemove,
}: {
  bookmark: Bookmark;
  subtitle?: string;
  onOpen: (bookmark: Bookmark) => void;
  onRename: (bookmark: Bookmark, name: string) => void;
  onRemove: (bookmark: Bookmark) => void;
}) {
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
      <div className="py-1 pr-3 pl-7">
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
    <div className="group flex items-start">
      {/* oxlint-disable-next-line react/forbid-elements -- contents-panel row: a full-width jump target styled with the contents list */}
      <button type="button" onClick={() => onOpen(bookmark)} className={cn(CONTENTS_ROW, "min-w-0 flex-1")}>
        <Body as="span" className="block min-w-0 break-words text-sm text-inherit">
          {bookmark.name}
        </Body>
        <Caption as="span" className="block text-fg-subtle">
          {subtitle ?? formatDate(new Date(bookmark.createdAt))}
        </Caption>
      </button>
      <div className="shrink-0 pt-1.5 pr-2">
        <DropdownMenu
          triggerLabel={t("bookmarkActions", { name: bookmark.name })}
          align="right"
          trigger={
            <span className={iconButtonClassName({ size: "sm" })}>
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
    </div>
  );
}

/** The book's bookmarks, oldest first, each opening, renaming or deleting in place. */
export function ReaderBookmarkList({
  bookmarks,
  failed,
  subtitleOf,
  onOpen,
  onRename,
  onRemove,
}: {
  bookmarks: Bookmark[] | null;
  failed: boolean;
  subtitleOf?: (bookmark: Bookmark) => string | undefined;
  onOpen: (bookmark: Bookmark) => void;
  onRename: (bookmark: Bookmark, name: string) => void;
  onRemove: (bookmark: Bookmark) => void;
}) {
  const { t } = useTranslation("reader");
  if (failed)
    return (
      <div className="px-5 py-2">
        <InlineError compact>{t("bookmarksLoadFailed")}</InlineError>
      </div>
    );
  if (bookmarks === null)
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  if (bookmarks.length === 0) return <Body className="px-5 py-2 text-sm text-fg-muted">{t("noBookmarks")}</Body>;
  return (
    <ul>
      {bookmarks.map((bookmark) => (
        <li key={bookmark.id}>
          <BookmarkRow
            bookmark={bookmark}
            subtitle={subtitleOf?.(bookmark)}
            onOpen={onOpen}
            onRename={onRename}
            onRemove={onRemove}
          />
        </li>
      ))}
    </ul>
  );
}
