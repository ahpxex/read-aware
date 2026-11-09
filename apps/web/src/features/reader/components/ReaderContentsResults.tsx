import { useMemo, type ReactNode } from "react";
import type { Bookmark, BookLocationHit, ReadingLocation } from "@read-aware/core";
import { Body, Caption, Eyebrow, InlineError, Spinner, VirtualRows, type VirtualRow } from "@read-aware/ui";
import { describeError, formatNumber, useTranslation } from "../../../i18n";
import type { Annotation } from "../../annotations";
import type { ContentsSearchState } from "../hooks/useContentsSearch";
import { TEXT_HIT_LIMIT } from "../hooks/useContentsSearch";
import type { TocEntry } from "../lib/reader-types";

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

/** A result group's label: what kind of match, and how many. */
function GroupLabel({ label, count }: { label: string; count?: number }) {
  return (
    <Eyebrow className="px-4 pt-4 pb-1.5">
      {label}
      {count !== undefined && <span className="text-fg-subtle"> · {formatNumber(count)}</span>}
    </Eyebrow>
  );
}

/** A chapter heading inside the text results, above that chapter's hits. */
function ChapterLabel({ label }: { label: string }) {
  return (
    <Caption as="p" className="truncate px-4 pt-2.5 pb-0.5 font-medium text-fg-subtle">
      {label}
    </Caption>
  );
}

/** One result: a full-width target with the notes list's hover surface. */
function Row({
  children,
  detail,
  onClick,
  disabled,
}: {
  children: ReactNode;
  detail?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="px-2">
      {/* oxlint-disable-next-line react/forbid-elements -- search result row: a full-width jump target */}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg disabled:opacity-60"
      >
        <Body as="span" className="line-clamp-3 block min-w-0 break-words text-sm leading-6 text-fg">
          {children}
        </Body>
        {detail && (
          <Caption as="span" className="mt-0.5 line-clamp-2 block text-fg-subtle">
            {detail}
          </Caption>
        )}
      </button>
    </div>
  );
}

/** The excerpt around a text hit: the match in full strength, its context muted. */
function Excerpt({ hit }: { hit: BookLocationHit }) {
  return (
    <span className="text-fg-muted">
      {hit.excerpt.pre.trimStart()}
      <span className="font-semibold text-fg">{hit.excerpt.match}</span>
      {hit.excerpt.post.trimEnd()}
    </span>
  );
}

/**
 * Everything in the open book that answers the query, in a fixed order —
 * chapters, printed pages, bookmarks, the reader's marks, then the book's
 * text, under the chapter each hit is in (it streams in as it is searched).
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
    const group = (key: string, label: string, count?: number) =>
      out.push({ key: `g:${key}`, size: 40, content: <GroupLabel label={label} count={count} /> });
    if (matches.chapters.length) {
      group("chapters", t("searchChapters"), matches.chapters.length);
      for (const index of matches.chapters) {
        const entry = entries[index]!;
        out.push({
          key: `c:${entry.id}`,
          size: 36,
          content: <Row onClick={() => onChapter(entry.href)}>{entry.label}</Row>,
        });
      }
    }
    if (search.pages.length) {
      group("pages", t("searchPages"));
      for (const page of search.pages)
        out.push({
          key: `p:${page.index}`,
          size: 36,
          content: (
            <Row onClick={() => onLocation(page.location!)}>
              {t("pageLabel", { label: page.label ?? String(page.index + 1) })}
            </Row>
          ),
        });
    }
    if (matches.bookmarks.length) {
      group("bookmarks", t("bookmarksTab"), matches.bookmarks.length);
      for (const bookmark of matches.bookmarks)
        out.push({
          key: `b:${bookmark.id}`,
          size: 36,
          content: <Row onClick={() => onBookmark(bookmark)}>{bookmark.name}</Row>,
        });
    }
    if (matches.marks.length) {
      group("marks", t("searchMarks"), matches.marks.length);
      for (const mark of matches.marks) {
        const note = mark.type === "note" ? mark.content : undefined;
        out.push({
          key: `m:${mark.id}`,
          size: 56,
          content: (
            <Row
              detail={note && mark.text ? <>&ldquo;{mark.text}&rdquo;</> : undefined}
              disabled={!mark.cfiRange}
              onClick={mark.cfiRange ? () => onMark(mark.cfiRange!) : undefined}
            >
              {note || <>&ldquo;{mark.text}&rdquo;</>}
            </Row>
          ),
        });
      }
    }
    const text = search.text;
    if (text.status !== "idle") {
      const hits = text.hits;
      group("text", t("searchText"), text.status === "done" ? hits.length : undefined);
      let chapter: string | undefined;
      for (const hit of hits) {
        const label = search.chapterOf?.(hit.sectionIndex);
        if (label && label !== chapter)
          out.push({ key: `h:${hit.id}`, size: 28, content: <ChapterLabel label={label} /> });
        chapter = label;
        out.push({
          key: `t:${hit.id}`,
          size: 64,
          content: (
            <Row onClick={() => onLocation(hit.location)}>
              <Excerpt hit={hit} />
            </Row>
          ),
        });
      }
      const note = (key: string, content: ReactNode) =>
        out.push({ key: `n:${key}`, size: 40, content: <div className="px-4 py-2">{content}</div> });
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
