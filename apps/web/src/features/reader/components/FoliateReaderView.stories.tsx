import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEFAULT_READER_SETTINGS } from "../../settings/lib/reader-settings";
import type { LibraryBook } from "../../library/lib/library-types";
import { FoliateReaderView } from "./FoliateReaderView";

const book: LibraryBook = {
  id: "book-pale-fire",
  title: "Pale Fire",
  author: "Vladimir Nabokov",
  format: "epub",
  fileName: "pale-fire.epub",
  mimeType: "application/epub+zip",
  fileSize: 1_480_000,
  coverUrl: null,
  coverChecked: true,
  createdAt: "2026-01-02T09:00:00.000Z",
  updatedAt: "2026-06-28T19:00:00.000Z",
  lastOpenedAt: "2026-06-28T19:00:00.000Z",
  progressPercent: 62,
  readingStatus: "reading",
  progress: null,
};

/**
 * The reader surface itself — the host for the vendored foliate-js engine.
 *
 * **What these stories can and cannot show.** Rendering a page needs a parsed
 * book handed in as `initialBook`, and the engine is loaded at runtime by
 * injecting the vendored ES-module tree from the app's `public/` directory. In
 * Storybook there is neither, so what renders is the reader's own frame: the
 * viewport it hands to the engine, the safe-area insets, and the page-turn
 * controls layered over it. Anything that depends on rendered text — selection,
 * annotations, pagination, text-unit modes — cannot be exercised here and is
 * verified in the running Tauri app instead.
 *
 * The pieces layered on top of the engine do have their own stories:
 * `ReaderSelectionMenu`, `ReaderPageTurnControls`, `ReaderSelectionHighlight`,
 * `ReaderCompletionScreen` and the navigator bar.
 */
const meta = {
  title: "Interface/Reader/FoliateReaderView",
  component: FoliateReaderView,
  parameters: { layout: "fullscreen" },
  args: {
    selectedBook: book,
    initialBook: null,
    readerSettings: DEFAULT_READER_SETTINGS,
    shellVisible: false,
  },
  decorators: [
    (Story) => (
      <div className="relative h-[36rem] w-full overflow-hidden border border-border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FoliateReaderView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The empty reader frame, before a book has been handed to the engine. */
export const EmptyFrame: Story = {};

/** The same frame with the reader chrome open above it. */
export const WithShellVisible: Story = {
  args: { shellVisible: true },
};

/** A dark reading theme, which the frame itself takes on. */
export const DarkTheme: Story = {
  args: { readerSettings: { ...DEFAULT_READER_SETTINGS, theme: "dark" } },
};

/** Continuous scroll rather than pagination — no page-turn controls. */
export const ScrollMode: Story = {
  args: { readerSettings: { ...DEFAULT_READER_SETTINGS, readingMode: "scroll" } },
};

/** No book selected at all, which is what the shell mounts before opening one. */
export const WithoutBook: Story = {
  args: { selectedBook: null },
};
