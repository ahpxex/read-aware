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
import type { Collection, LibraryBook } from "../../library/lib/library-types";
import type { ShelfGroup, ShelfLayout, ShelfSort, ShelfView } from "../../shelf/lib/shelf-view";
import type { TopNav } from "../../../state/ui";

export type CommandKind = "action" | "collection" | "book";

export type CommandItem = {
  id: string;
  kind: CommandKind;
  title: string;
  subtitle?: string;
  /** Section heading; groups render in `GROUP_ORDER`. */
  group: string;
  /** Extra text folded into matching (synonyms, the value being set, etc.). */
  keywords?: string;
  icon: ReactNode;
  /** Cover for book items; the icon is used as a fallback. */
  coverUrl?: string | null;
  perform: () => void;
};

/** Fixed section order in the palette. */
export const GROUP_ORDER = ["Go to", "Shelf", "Collections", "Books"] as const;

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

const SORT_LABELS: Record<ShelfSort, string> = {
  recent: "Recently opened",
  added: "Recently added",
  title: "Title",
  author: "Author",
  progress: "Progress",
};

const GROUP_LABELS: Record<ShelfGroup, string> = {
  none: "None",
  status: "Reading status",
  author: "Author",
  format: "Format",
};

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
export function buildCommands(ctx: CommandContext): CommandItem[] {
  const items: CommandItem[] = [];

  // ── Go to ────────────────────────────────────────────────────────────────
  if (ctx.activeTopNav !== "shelf") {
    items.push({ id: "go-shelf", kind: "action", group: "Go to", title: "Library", keywords: "shelf books home", icon: icon(Books), perform: ctx.goShelf });
  }
  if (ctx.activeTopNav !== "stats") {
    items.push({ id: "go-stats", kind: "action", group: "Go to", title: "Reading stats", keywords: "statistics charts streak time", icon: icon(ChartLineUp), perform: ctx.goStats });
  }
  if (ctx.activeTopNav !== "context") {
    items.push({ id: "go-context", kind: "action", group: "Go to", title: "Context", keywords: "ai notes", icon: icon(Cards), perform: ctx.goContext });
  }
  items.push({ id: "open-settings", kind: "action", group: "Go to", title: "Settings", keywords: "preferences appearance", icon: icon(GearSix), perform: ctx.openSettings });

  // ── Shelf ────────────────────────────────────────────────────────────────
  items.push({ id: "import", kind: "action", group: "Shelf", title: "Import book", keywords: "add file epub pdf", icon: icon(Plus), perform: ctx.importBook });
  items.push({ id: "select", kind: "action", group: "Shelf", title: "Select books", keywords: "batch multiple manage", icon: icon(ListChecks), perform: ctx.startSelection });

  const nextLayout: ShelfLayout = ctx.shelfView.layout === "grid" ? "list" : "grid";
  items.push({
    id: `layout-${nextLayout}`,
    kind: "action",
    group: "Shelf",
    title: `Switch to ${nextLayout} view`,
    keywords: "layout grid list view",
    icon: icon(nextLayout === "grid" ? SquaresFour : Rows),
    perform: () => ctx.setLayout(nextLayout),
  });

  for (const sort of Object.keys(SORT_LABELS) as ShelfSort[]) {
    if (sort === ctx.shelfView.sort) continue;
    items.push({
      id: `sort-${sort}`,
      kind: "action",
      group: "Shelf",
      title: `Sort by ${SORT_LABELS[sort].toLowerCase()}`,
      keywords: "order sort",
      icon: icon(ArrowsDownUp),
      perform: () => ctx.setSort(sort),
    });
  }

  for (const group of Object.keys(GROUP_LABELS) as ShelfGroup[]) {
    if (group === ctx.shelfView.group) continue;
    items.push({
      id: `group-${group}`,
      kind: "action",
      group: "Shelf",
      title: group === "none" ? "Don’t group" : `Group by ${GROUP_LABELS[group].toLowerCase()}`,
      keywords: "group section",
      icon: icon(Stack),
      perform: () => ctx.setGroup(group),
    });
  }

  // ── Collections ──────────────────────────────────────────────────────────
  for (const collection of ctx.collections) {
    items.push({
      id: `collection-${collection.id}`,
      kind: "collection",
      group: "Collections",
      title: collection.name,
      subtitle: "Collection",
      keywords: "collection folder group",
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
      group: "Books",
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
