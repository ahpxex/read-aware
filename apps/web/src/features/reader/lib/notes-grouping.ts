/**
 * The notes list's order: bookmarks, highlights and notes together, grouped
 * under their chapter in the contents' order and newest first within each.
 */
import type { BookTocEntry, Bookmark } from "@read-aware/core";
import type { Annotation } from "../../annotations";
import { normalizeHref } from "./epub-utils";
import type { TocEntry } from "./reader-types";

/** A bookmark or an annotation: the notes list shows both, interleaved. */
export type Mark = { kind: "bookmark"; bookmark: Bookmark } | { kind: "annotation"; annotation: Annotation };
export type MarkGroup = { label: string | null; items: Mark[] };

const chapterOf = (mark: Mark) => (mark.kind === "bookmark" ? mark.bookmark.chapterHref : mark.annotation.chapterHref);
const timeOf = (mark: Mark) => (mark.kind === "bookmark" ? mark.bookmark.createdAt : mark.annotation.createdAt);

/** What grouping needs of a contents entry: where it points and its title. */
export type ChapterAnchor = Pick<TocEntry, "href" | "label">;

/**
 * The library's contents tree as chapter anchors in reading order (depth
 * first, as the contents list reads), for grouping marks outside the reader.
 * Entries with no resolved location cannot claim a mark and are skipped.
 */
export function chapterAnchorsFromToc(entries: readonly BookTocEntry[]): ChapterAnchor[] {
  const anchors: ChapterAnchor[] = [];
  const walk = (level: readonly BookTocEntry[]) => {
    for (const entry of level) {
      const href = entry.location?.href;
      if (href) anchors.push({ href, label: entry.label });
      walk(entry.children);
    }
  };
  walk(entries);
  return anchors;
}

/** Marks that map to no chapter fall into a trailing, unlabelled group. */
export function groupMarksByChapter(marks: readonly Mark[], tocEntries: readonly ChapterAnchor[]): MarkGroup[] {
  const sorted = [...marks].sort((a, b) => timeOf(b).localeCompare(timeOf(a)));
  const groups: MarkGroup[] = [];
  const claimed = new Set<Mark>();
  for (const entry of tocEntries) {
    const key = normalizeHref(entry.href);
    const items = sorted.filter((mark) => {
      const href = chapterOf(mark);
      return !!href && normalizeHref(href) === key && !claimed.has(mark);
    });
    if (items.length === 0) continue;
    items.forEach((mark) => claimed.add(mark));
    groups.push({ label: entry.label, items });
  }
  const rest = sorted.filter((mark) => !claimed.has(mark));
  if (rest.length > 0) groups.push({ label: null, items: rest });
  return groups;
}
