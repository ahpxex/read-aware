import {
  ArrowsDownUp,
  Books,
  ChartLineUp,
  ChatCircleDots,
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
import { HOST_SHELF_SORTS, HOST_SHELF_GROUPS, type HostCommandRequest } from "@read-aware/core";
import type { TFunction } from "i18next";
import type { Collection, LibraryBook } from "../../library/lib/library-types";
import type {
  ShelfLayout,
  ShelfView,
} from "../../shelf/lib/shelf-view";
import type { TopNav } from "../../../state/ui";

export type CommandKind = "action" | "collection" | "book";

/** Stable section identity (kept out of copy so it survives translation). */
export type CommandGroupKey =
  "goto" | "shelf" | "collections" | "books" | "plugins";

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
  disabled?: boolean;
  checked?: boolean;
} & ({ hostCommand: HostCommandRequest; perform?: never } | { hostCommand?: never; perform: (signal?: AbortSignal) => unknown | Promise<unknown> });

/** Fixed section order in the palette. */
export const GROUP_ORDER: readonly CommandGroupKey[] = [
  "goto",
  "shelf",
  "plugins",
  "collections",
  "books",
];

export type CommandActions = {
  importBook: () => void;
};

export type CommandContext = {
  activeTopNav: TopNav;
  readingBookId: string | null;
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
export function buildCommands(
  ctx: CommandContext,
  t: TFunction<"command">,
): CommandItem[] {
  const items: CommandItem[] = [];

  // ── Go to ────────────────────────────────────────────────────────────────
  if (ctx.activeTopNav !== "shelf" || ctx.readingBookId !== null) {
    items.push({
      id: "go-shelf",
      kind: "action",
      group: "goto",
      title: t("actions.goShelf.title"),
      keywords: t("actions.goShelf.keywords"),
      icon: icon(Books),
      hostCommand: { id: "go-shelf" },
    });
  }
  if (ctx.activeTopNav !== "stats") {
    items.push({
      id: "go-stats",
      kind: "action",
      group: "goto",
      title: t("actions.goStats.title"),
      keywords: t("actions.goStats.keywords"),
      icon: icon(ChartLineUp),
      hostCommand: { id: "go-stats" },
    });
  }
  if (ctx.activeTopNav !== "agent") {
    items.push({
      id: "go-context",
      kind: "action",
      group: "goto",
      title: t("actions.goAgent.title"),
      keywords: t("actions.goAgent.keywords"),
      icon: icon(ChatCircleDots),
      hostCommand: { id: "go-context" },
    });
  }
  items.push({
    id: "open-settings",
    kind: "action",
    group: "goto",
    title: t("actions.openSettings.title"),
    keywords: t("actions.openSettings.keywords"),
    icon: icon(GearSix),
    hostCommand: { id: "open-settings" },
  });

  // ── Shelf ────────────────────────────────────────────────────────────────
  items.push({
    id: "import",
    kind: "action",
    group: "shelf",
    title: t("actions.import.title"),
    keywords: t("actions.import.keywords"),
    icon: icon(Plus),
    perform: ctx.importBook,
  });
  items.push({
    id: "select",
    kind: "action",
    group: "shelf",
    title: t("actions.select.title"),
    keywords: t("actions.select.keywords"),
    icon: icon(ListChecks),
    hostCommand: { id: "select" },
  });

  const nextLayout: ShelfLayout =
    ctx.shelfView.layout === "grid" ? "list" : "grid";
  items.push({
    id: `layout-${nextLayout}`,
    kind: "action",
    group: "shelf",
    title: t(`layout.${nextLayout}`),
    keywords: t("layout.keywords"),
    icon: icon(nextLayout === "grid" ? SquaresFour : Rows),
    hostCommand: { id: `layout-${nextLayout}` },
  });

  for (const sort of HOST_SHELF_SORTS) {
    if (sort === ctx.shelfView.sort) continue;
    items.push({
      id: `sort-${sort}`,
      kind: "action",
      group: "shelf",
      title: t(`sort.by.${sort}`),
      keywords: t("sort.keywords"),
      icon: icon(ArrowsDownUp),
      hostCommand: { id: `sort-${sort}` },
    });
  }

  for (const group of HOST_SHELF_GROUPS) {
    if (group === ctx.shelfView.group) continue;
    items.push({
      id: `group-${group}`,
      kind: "action",
      group: "shelf",
      title: group === "none" ? t("group.none") : t(`group.by.${group}`),
      keywords: t("group.keywords"),
      icon: icon(Stack),
      hostCommand: { id: `group-${group}` },
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
      hostCommand: { id: "open-collection", args: { collectionId: collection.id } },
    });
  }

  // ── Books (most recently opened first, so the empty-query default is useful) ─
  const booksByRecency = [...ctx.books].sort(
    (a, b) => recencyTime(b) - recencyTime(a),
  );
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
      hostCommand: { id: "open-book", args: { bookId: book.id } },
    });
  }

  return items;
}
