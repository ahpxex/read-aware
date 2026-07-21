import {
  ArrowsDownUp,
  Books,
  Cards,
  ChartLineUp,
  FolderSimple,
  GearSix,
  ListChecks,
  Plus,
  Rows,
  SquaresFour,
  Stack,
  type Icon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import type { Collection, LibraryBook } from "../../library/lib/library-types";
import type { ShelfGroup, ShelfLayout, ShelfSort, ShelfView } from "../../shelf/lib/shelf-view";
import type { TopNav } from "../../../state/ui";

export type CommandKind = "action" | "collection" | "book";

/** Stable section identity (kept out of copy so it survives translation). */
export type CommandGroupKey = "goto" | "shelf" | "collections" | "books" | "plugins";

export type CommandItem = {
  id: string;
  kind: CommandKind;
  title: string;
  subtitle?: string;
  /** Section identity; groups render in `GROUP_ORDER`. */
  group: CommandGroupKey;
  /** Extra text folded into matching (synonyms, the value being set, etc.). */
  keywords?: string;
  icon: ReactNode;
  /** Cover for book items; the icon is used as a fallback. */
  coverUrl?: string | null;
  perform: () => void;
};

/** Fixed section order in the palette. */
export const GROUP_ORDER: readonly CommandGroupKey[] = [
  "goto",
  "shelf",
  "plugins",
  "collections",
  "books",
];

export type CommandActions = {
  openBook: (book: LibraryBook) => void;
  openCollection: (id: string) => void;
  goShelf: () => void;
  goContext: () => void;
  goStats: () => void;
  openSettings: () => void;
  importBook: () => void;
  startSelection: () => void;
  setLayout: (layout: ShelfLayout) => void;
  setSort: (sort: ShelfSort) => void;
  setGroup: (group: ShelfGroup) => void;
};

export type CommandContext = {
  activeTopNav: TopNav;
  shelfView: ShelfView;
  collections: Collection[];
  books: LibraryBook[];
} & CommandActions;

function icon(Glyph: Icon): ReactNode {
  return <Glyph size={16} weight="regular" aria-hidden="true" />;
}

function recencyTime(book: LibraryBook): number {
  return new Date(book.lastOpenedAt ?? book.updatedAt).getTime();
}

/**
 * The full, context-aware command set for the palette: navigation, shelf view
 * controls (the layout toggle and the inactive sort/group options only), every
 * collection, and every book. Pure — the UI filters and renders the result.
 */
export function buildCommands(ctx: CommandContext, t: TFunction<"command">): CommandItem[] {
  const items: CommandItem[] = [];

  // ── Go to ────────────────────────────────────────────────────────────────
  if (ctx.activeTopNav !== "shelf") {
    items.push({ id: "go-shelf", kind: "action", group: "goto", title: t("actions.goShelf.title"), keywords: t("actions.goShelf.keywords"), icon: icon(Books), perform: ctx.goShelf });
  }
  if (ctx.activeTopNav !== "stats") {
    items.push({ id: "go-stats", kind: "action", group: "goto", title: t("actions.goStats.title"), keywords: t("actions.goStats.keywords"), icon: icon(ChartLineUp), perform: ctx.goStats });
  }
  if (ctx.activeTopNav !== "context") {
    items.push({ id: "go-context", kind: "action", group: "goto", title: t("actions.goContext.title"), keywords: t("actions.goContext.keywords"), icon: icon(Cards), perform: ctx.goContext });
  }
  items.push({ id: "open-settings", kind: "action", group: "goto", title: t("actions.openSettings.title"), keywords: t("actions.openSettings.keywords"), icon: icon(GearSix), perform: ctx.openSettings });

  // ── Shelf ────────────────────────────────────────────────────────────────
  items.push({ id: "import", kind: "action", group: "shelf", title: t("actions.import.title"), keywords: t("actions.import.keywords"), icon: icon(Plus), perform: ctx.importBook });
  items.push({ id: "select", kind: "action", group: "shelf", title: t("actions.select.title"), keywords: t("actions.select.keywords"), icon: icon(ListChecks), perform: ctx.startSelection });

  const nextLayout: ShelfLayout = ctx.shelfView.layout === "grid" ? "list" : "grid";
  items.push({
    id: `layout-${nextLayout}`,
    kind: "action",
    group: "shelf",
    title: t(`layout.${nextLayout}`),
    keywords: t("layout.keywords"),
    icon: icon(nextLayout === "grid" ? SquaresFour : Rows),
    perform: () => ctx.setLayout(nextLayout),
  });

  for (const sort of ["recent", "added", "title", "author", "progress"] as ShelfSort[]) {
    if (sort === ctx.shelfView.sort) continue;
    items.push({
      id: `sort-${sort}`,
      kind: "action",
      group: "shelf",
      title: t(`sort.by.${sort}`),
      keywords: t("sort.keywords"),
      icon: icon(ArrowsDownUp),
      perform: () => ctx.setSort(sort),
    });
  }

  for (const group of ["none", "status", "author", "format"] as ShelfGroup[]) {
    if (group === ctx.shelfView.group) continue;
    items.push({
      id: `group-${group}`,
      kind: "action",
      group: "shelf",
      title: group === "none" ? t("group.none") : t(`group.by.${group}`),
      keywords: t("group.keywords"),
      icon: icon(Stack),
      perform: () => ctx.setGroup(group),
    });
  }

  // ── Collections ──────────────────────────────────────────────────────────
  for (const collection of ctx.collections) {
    items.push({
      id: `collection-${collection.id}`,
      kind: "collection",
      group: "collections",
      title: collection.name,
      subtitle: t("collection.subtitle"),
      keywords: t("collection.keywords"),
      icon: icon(FolderSimple),
      perform: () => ctx.openCollection(collection.id),
    });
  }

  // ── Books (most recently opened first, so the empty-query default is useful) ─
  const booksByRecency = [...ctx.books].sort((a, b) => recencyTime(b) - recencyTime(a));
  for (const book of booksByRecency) {
    items.push({
      id: `book-${book.id}`,
      kind: "book",
      group: "books",
      title: book.title,
      subtitle: book.author,
      keywords: book.format,
      icon: icon(Books),
      coverUrl: book.coverUrl,
      perform: () => ctx.openBook(book),
    });
  }

  return items;
}
