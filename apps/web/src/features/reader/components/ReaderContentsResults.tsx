import { useMemo, type ReactNode } from "react";
import type { Bookmark, BookLocationHit, ReadingLocation } from "@read-aware/core";
import { Body, Caption, Eyebrow, InlineError, Spinner, VirtualRows, type VirtualRow } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { describeError, formatNumber, useTranslation } from "../../../i18n";
import type { Annotation } from "../../annotations";
import type { ContentsSearchState } from "../hooks/useContentsSearch";
import { TEXT_HIT_LIMIT } from "../hooks/useContentsSearch";
import type { TocEntry } from "../lib/reader-types";
import { CONTENTS_ROW } from "./ReaderBookmarkList";

export type ContentsMatches = {
  chapters: number[];
  bookmarks: Bookmark[];
  marks: Annotation[];
};

type Handlers = {
  onChapter: (href: string) => void;
  onBookmark: (bookmark: Bookmark) => void;
  onMark: (cfiRange: string) => void;
  onLocation: (location: ReadingLocation) => void;
};

function Header({ label, count }: { label: string; count?: number }) {
  return (
    <Eyebrow className="px-7 pt-4 pb-1">
      {label}
      {count !== undefined && <span className="text-fg-subtle"> · {formatNumber(count)}</span>}
    </Eyebrow>
  );
}

function Row({
  title,
  subtitle,
  onClick,
  disabled,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    // oxlint-disable-next-line react/forbid-elements -- contents-panel result row: a full-width jump target styled with the contents list
    <button type="button" onClick={onClick} disabled={disabled} className={cn(CONTENTS_ROW, "disabled:opacity-60")}>
      <Body as="span" className="line-clamp-3 block min-w-0 break-words text-sm leading-6 text-inherit">
        {title}
      </Body>
      {subtitle && (
        <Caption as="span" className="block truncate text-fg-subtle">
          {subtitle}
        </Caption>
      )}
    </button>
  );
}

function hitTitle(hit: BookLocationHit) {
  return (
    <>
      {hit.excerpt.pre}
      <span className="font-semibold text-fg">{hit.excerpt.match}</span>
      {hit.excerpt.post}
    </>
  );
}

/**
 * Everything in the open book that answers the query, in a fixed order —
 * chapters, printed pages, bookmarks, the reader's marks, then the book's
 * text (which streams in as it is searched).
 */
export function ReaderContentsResults({
  query,
  entries,
  matches,
  search,
  onChapter,
  onBookmark,
  onMark,
  onLocation,
}: {
  query: string;
  entries: TocEntry[];
  matches: ContentsMatches;
  search: ContentsSearchState;
} & Handlers) {
  const { t } = useTranslation("reader");
  const rows = useMemo<VirtualRow[]>(() => {
    const out: VirtualRow[] = [];
    const header = (key: string, label: string, count?: number) =>
      out.push({ key: `h:${key}`, size: 36, content: <Header label={label} count={count} /> });
    if (matches.chapters.length) {
      header("chapters", t("searchChapters"), matches.chapters.length);
      for (const index of matches.chapters) {
        const entry = entries[index]!;
        out.push({
          key: `c:${entry.id}`,
          size: 44,
          content: <Row title={entry.label} onClick={() => onChapter(entry.href)} />,
        });
      }
    }
    if (search.pages.length) {
      header("pages", t("searchPages"));
      for (const page of search.pages)
        out.push({
          key: `p:${page.index}`,
          size: 44,
          content: (
            <Row
              title={t("pageLabel", { label: page.label ?? String(page.index + 1) })}
              onClick={() => onLocation(page.location!)}
            />
          ),
        });
    }
    if (matches.bookmarks.length) {
      header("bookmarks", t("bookmarksTab"), matches.bookmarks.length);
      for (const bookmark of matches.bookmarks)
        out.push({
          key: `b:${bookmark.id}`,
          size: 44,
          content: <Row title={bookmark.name} onClick={() => onBookmark(bookmark)} />,
        });
    }
    if (matches.marks.length) {
      header("marks", t("searchMarks"), matches.marks.length);
      for (const mark of matches.marks) {
        const note = mark.type === "note" ? mark.content : undefined;
        out.push({
          key: `m:${mark.id}`,
          size: 64,
          content: (
            <Row
              title={note || mark.text}
              subtitle={note && mark.text ? mark.text : undefined}
              disabled={!mark.cfiRange}
              onClick={mark.cfiRange ? () => onMark(mark.cfiRange!) : undefined}
            />
          ),
        });
      }
    }
    const text = search.text;
    if (text.status !== "idle") {
      const hits = text.hits;
      header("text", t("searchText"), text.status === "done" ? hits.length : undefined);
      for (const hit of hits)
        out.push({
          key: `t:${hit.id}`,
          size: 76,
          content: <Row title={hitTitle(hit)} onClick={() => onLocation(hit.location)} />,
        });
      const note = (key: string, content: ReactNode) =>
        out.push({ key: `n:${key}`, size: 40, content: <div className="px-7 py-2">{content}</div> });
      if (text.status === "searching")
        note(
          "progress",
          <Caption as="p" className="flex items-center gap-2 text-fg-muted">
            <Spinner size="sm" />
            {text.totalSections
              ? t("searchingTextProgress", { scanned: text.scannedSections, total: text.totalSections })
              : t("searchingText")}
          </Caption>,
        );
      else if (text.status === "error")
        note("error", <InlineError compact>{describeError(text.error).body}</InlineError>);
      else if (text.truncated)
        note(
          "truncated",
          <Caption className="text-fg-muted">{t("searchTextTruncated", { count: TEXT_HIT_LIMIT })}</Caption>,
        );
      else if (!hits.length)
        note(
          "empty",
          <Caption className="text-fg-muted">
            {text.textStatus === "textless"
              ? t("searchTextless")
              : text.textStatus === "unsupported" || text.textStatus === "partial"
                ? t("searchTextPartial")
                : t("searchTextNoHits", { query })}
          </Caption>,
        );
      else if (text.textStatus === "partial")
        note("partial", <Caption className="text-fg-muted">{t("searchTextPartial")}</Caption>);
    }
    return out;
  }, [entries, matches, query, search, t, onChapter, onBookmark, onMark, onLocation]);
  return <VirtualRows rows={rows} />;
}
