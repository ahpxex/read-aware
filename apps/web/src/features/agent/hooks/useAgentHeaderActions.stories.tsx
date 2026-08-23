import type { Meta, StoryObj } from "@storybook/react-vite";
import { MenuOverflow } from "../../menus/components/MenuOverflow";
import type { LibraryBook } from "../../library/lib/library-types";
import { useAgentHeaderActions } from "./useAgentHeaderActions";

const book: LibraryBook = {
  id: "book-pale-fire",
  title: "Pale Fire",
  author: "Vladimir Nabokov",
  format: "epub",
  fileName: "pale-fire.epub",
  mimeType: "application/epub+zip",
  fileSize: 1_480_000,
  coverUrl: null,
  createdAt: "2026-01-02T09:00:00.000Z",
  updatedAt: "2026-06-28T19:00:00.000Z",
  lastOpenedAt: "2026-06-28T19:00:00.000Z",
  progressPercent: 62,
  readingStatus: "reading",
  progress: null,
};

/**
 * The Agent page's header actions: new conversation, the thread switcher, and
 * the annotations browser.
 *
 * They are *atomized* rather than one cluster, which is the point of the hook:
 * each entry carries both an inline rendering and an overflow rendering, so a
 * narrowing window can collapse them one at a time. The popovers ride into the
 * menu as `node` entries and open from its panel — they don't degrade into
 * plain menu items.
 *
 * Both renderings are shown here side by side. The lists inside the popovers
 * load over Tauri IPC, so they open empty; `ThreadsPopoverView` and
 * `AnnotationsPopoverView` carry the populated states.
 */
const meta = {
  title: "Interface/Agent/AgentHeaderActions",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness({ books }: { books: LibraryBook[] }) {
  const entries = useAgentHeaderActions({
    books,
    onOpenBook: () => {},
    onNewConversation: () => {},
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div>
        <span className="mb-2 block text-xs text-fg-subtle">inline</span>
        <div className="flex items-center justify-end gap-1 rounded-md border border-border bg-surface px-3 py-2">
          {entries.map((entry) => (
            <span key={entry.id}>{entry.inline}</span>
          ))}
        </div>
      </div>
      <div>
        <span className="mb-2 block text-xs text-fg-subtle">collapsed into the dots menu</span>
        <div className="flex items-center justify-end rounded-md border border-border bg-surface px-3 py-2">
          <MenuOverflow entries={entries.map((entry) => entry.overflow)} />
        </div>
      </div>
    </div>
  );
}

/** All three actions, in both renderings. */
export const InlineAndOverflow: Story = {
  render: () => <Harness books={[book]} />,
};

/** With an empty library, which the annotations browser has to survive. */
export const WithoutBooks: Story = {
  render: () => <Harness books={[]} />,
};
