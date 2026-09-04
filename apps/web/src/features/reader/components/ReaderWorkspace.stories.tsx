import type { Meta, StoryObj } from "@storybook/react-vite";
import type { LibraryBook } from "../../library/lib/library-types";
import { ReaderWorkspace } from "./ReaderWorkspace";

const book: LibraryBook = {
  id: "book-pale-fire",
  title: "Pale Fire",
  author: "Vladimir Nabokov",
  format: "epub",
  fileName: "pale-fire.epub",
  mimeType: "application/epub+zip",
  fileSize: 1_480_000,
  coverUrl: null,
  coverStatus: "none",
  coverBlobKey: null,
  coverLocal: false,
  coverVersion: null,
  createdAt: "2026-01-02T09:00:00.000Z",
  updatedAt: "2026-06-28T19:00:00.000Z",
  lastOpenedAt: "2026-06-28T19:00:00.000Z",
  progressPercent: 62,
  readingStatus: "reading",
  progress: null,
};

/**
 * The reader shell around an open book.
 *
 * With a `readerSource` it mounts the foliate engine, which needs a real
 * parsed book and the vendored engine tree — neither of which exists outside
 * the app, so these stories deliberately cover the states where there is no
 * source yet: opening, and every way opening can fail.
 *
 * Those failure states are worth the attention. The recovery offered depends on
 * *why* the file is missing: a transient fetch can be retried, but a file the
 * relay never held needs the original back instead — re-importing it heals the
 * book in place through the sha dedup gate. Getting that branch wrong sends
 * readers in a circle.
 */
const meta = {
  title: "Interface/Reader/ReaderWorkspace",
  component: ReaderWorkspace,
  parameters: { layout: "fullscreen" },
  args: {
    selectedBook: book,
    readerSource: null,
    readerLoadError: null,
    isReaderLoading: true,
    readerToc: [],
    currentChapterHref: null,
    chapterNavigationRequest: null,
    annotationNavigationRequest: null,
    fractionNavigationRequest: null,
    overlayVisible: true,
    selectedEpubProgress: null,
    readerProgress: 0.62,
    currentPage: 120,
    totalPages: 480,
    onCloseReader: () => {},
    onRetryOpen: () => {},
    onReimportBook: () => {},
    onToggleShell: () => {},
    onHideShell: () => {},
    onReaderPageChange: () => {},
    onEpubProgressChange: () => {},
    onReaderFractionChange: () => {},
    onSeek: () => {},
    onTocChange: () => {},
    onCurrentChapterChange: () => {},
    onBookReady: () => {},
    onChapterSelect: () => {},
    onAnnotationSelect: () => {},
  },
  decorators: [
    (Story) => (
      <div className="relative h-[42rem] w-full overflow-hidden">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReaderWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opening the book: the shell is up, the engine has nothing yet. */
export const Opening: Story = {};

/** A generic failure, in whatever words the library layer produced. */
export const GenericError: Story = {
  args: {
    isReaderLoading: false,
    readerLoadError: { kind: "generic", message: "The file could not be parsed as EPUB." },
  },
};

/**
 * The book exists in the library, but its bytes never reached this device and
 * sync is off. Retrying cannot help — the offer is to re-import the file.
 */
export const FileMissingNoSync: Story = {
  args: {
    isReaderLoading: false,
    readerLoadError: { kind: "file-missing", reason: "no-sync" },
  },
};

/** The relay never held this book's file either — again, re-import. */
export const FileMissingNotOnRelay: Story = {
  args: {
    isReaderLoading: false,
    readerLoadError: { kind: "file-missing", reason: "not-on-relay" },
  },
};

/** A dead session: retry is the right offer once signed back in. */
export const FileMissingUnauthenticated: Story = {
  args: {
    isReaderLoading: false,
    readerLoadError: { kind: "file-missing", reason: "unauthenticated" },
  },
};

/** Offline or the relay is down — transient, so retry. */
export const FileMissingUnreachable: Story = {
  args: {
    isReaderLoading: false,
    readerLoadError: { kind: "file-missing", reason: "unreachable" },
  },
};

/** The bytes arrived but could not be decrypted. */
export const FileMissingUndecodable: Story = {
  args: {
    isReaderLoading: false,
    readerLoadError: { kind: "file-missing", reason: "undecodable" },
  },
};

/** The same failure with the reader chrome dismissed. */
export const ErrorWithShellHidden: Story = {
  args: {
    isReaderLoading: false,
    overlayVisible: false,
    readerLoadError: { kind: "file-missing", reason: "not-on-relay" },
  },
};
