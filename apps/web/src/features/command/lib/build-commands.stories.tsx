import type { Meta, StoryObj } from "@storybook/react-vite";
import { useTranslation } from "../../../i18n";
import type { Collection, LibraryBook } from "../../library/lib/library-types";
import { buildCommands, type CommandContext } from "./build-commands";

const noop = () => {};

const base: LibraryBook = {
  id: "1",
  title: "Untitled",
  author: "Unknown author",
  format: "epub",
  fileName: "book.epub",
  mimeType: "application/epub+zip",
  fileSize: 1024,
  coverUrl: null,
  createdAt: "2026-03-13T00:00:00.000Z",
  updatedAt: "2026-03-13T00:00:00.000Z",
  lastOpenedAt: null,
  progressPercent: 0,
  readingStatus: "unread",
  progress: null,
  starred: false,
};

const books: LibraryBook[] = [
  { ...base, id: "1", title: "Pale Fire", author: "Vladimir Nabokov", lastOpenedAt: "2026-06-27T09:00:00.000Z", progressPercent: 62, readingStatus: "reading", collectionId: "c1" },
  { ...base, id: "2", title: "The Sea, The Sea", author: "Iris Murdoch", lastOpenedAt: "2026-06-20T09:00:00.000Z", progressPercent: 24, readingStatus: "reading" },
  { ...base, id: "3", title: "Invisible Cities", author: "Italo Calvino", collectionId: "c2" },
];

const collections: Collection[] = [
  { id: "c1", name: "Philosophy", createdAt: "2026-01-14T10:00:00.000Z" },
  { id: "c2", name: "To read", createdAt: "2026-02-03T10:00:00.000Z" },
];

const ctx: CommandContext = {
  activeTopNav: "shelf",
  readingBookId: null,
  shelfView: { layout: "grid", group: "none", sort: "recent" },
  collections,
  books,
  openBook: noop,
  openCollection: noop,
  goShelf: noop,
  goContext: noop,
  goStats: noop,
  openSettings: noop,
  importBook: noop,
  startSelection: noop,
  setLayout: noop,
  setSort: noop,
  setGroup: noop,
};

/**
 * The command set itself — the data behind ⌘K.
 *
 * `buildCommands` is a pure function of the current context, and that context
 * *removes* commands as much as it adds them: you are never offered "Go to
 * shelf" while already on the shelf, or a layout you are already in. That
 * conditional shape is the thing worth seeing, so these stories render the
 * produced set as a table rather than the palette (which has its own stories).
 */
const meta = {
  title: "Interface/Command/BuildCommands",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function CommandTable({ context }: { context: CommandContext }) {
  const { t } = useTranslation("command");
  const items = buildCommands(context, t);
  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-3 text-xs text-fg-subtle">
        {items.length} commands
      </p>
      <div className="flex flex-col">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 border-t border-border py-2 first:border-t-0"
          >
            <span className="w-4 shrink-0 text-fg-muted">{item.icon}</span>
            <span className="min-w-0 flex-1 text-sm text-fg">{item.title}</span>
            {item.subtitle && (
              <span className="text-xs text-fg-muted">{item.subtitle}</span>
            )}
            <code className="w-20 text-right text-[10px] text-fg-subtle">{item.group}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

/** On the shelf: navigation to elsewhere, shelf controls, collections, books. */
export const OnTheShelf: Story = {
  render: () => <CommandTable context={ctx} />,
};

/** On the Context page — "Go to Agent" drops out, "Go to shelf" appears. */
export const OnTheContextPage: Story = {
  render: () => <CommandTable context={{ ...ctx, activeTopNav: "context" }} />,
};

/** On the stats page. */
export const OnTheStatsPage: Story = {
  render: () => <CommandTable context={{ ...ctx, activeTopNav: "stats" }} />,
};

/** While reading: the shelf becomes a destination again even from the shelf tab. */
export const WhileReading: Story = {
  render: () => <CommandTable context={{ ...ctx, readingBookId: "1" }} />,
};

/** In list layout, where the layout commands offered flip. */
export const InListLayout: Story = {
  render: () => (
    <CommandTable
      context={{ ...ctx, shelfView: { layout: "list", group: "none", sort: "recent" } }}
    />
  ),
};

/** An empty library: no book or collection commands to offer at all. */
export const EmptyLibrary: Story = {
  render: () => <CommandTable context={{ ...ctx, books: [], collections: [] }} />,
};
