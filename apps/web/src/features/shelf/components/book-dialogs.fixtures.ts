/** Story fixtures for the shelf's book dialogs. */
import type { Highlight, Note } from "../../annotations";
import type { LibraryBook } from "../../library";
import type { ChapterAnchor } from "../../reader";
import type { BookDetailsMarks } from "../hooks/useBookDetailsMarks";

export const book: LibraryBook = {
  id: "book-pale-fire",
  title: "Pale Fire",
  author: "Vladimir Nabokov",
  format: "epub",
  fileName: "pale-fire.epub",
  mimeType: "application/epub+zip",
  fileSize: 1_480_000,
  coverUrl:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='360'%3E%3Crect width='240' height='360' fill='%231c1917'/%3E%3Ctext x='20' y='52' fill='%23f5f1e8' font-family='Georgia' font-size='24' font-weight='bold'%3EPale Fire%3C/text%3E%3Ctext x='20' y='80' fill='%23a8a29e' font-family='Georgia' font-size='15'%3ENabokov%3C/text%3E%3C/svg%3E",
  coverStatus: "none",
  coverBlobKey: null,
  coverLocal: false,
  fileLocal: true,
  annotationCount: 0,
  coverVersion: null,
  createdAt: "2026-01-02T09:00:00.000Z",
  updatedAt: "2026-06-28T19:00:00.000Z",
  lastOpenedAt: "2026-06-28T19:00:00.000Z",
  progressPercent: 62,
  readingStatus: "reading",
  progress: {
    currentLocation: 240,
    totalLocations: 480,
    progressPercent: 62,
    cfi: null,
    href: null,
  },
  starred: true,
};

/** Pale Fire's parts, in reading order. */
export const chapters: ChapterAnchor[] = [
  { href: "foreword.xhtml", label: "Foreword" },
  { href: "poem.xhtml", label: "Pale Fire: A Poem in Four Cantos" },
  { href: "commentary.xhtml", label: "Commentary" },
];

const at = (day: number) => `2026-06-${String(day).padStart(2, "0")}T19:00:00.000Z`;
const highlight = (
  id: string,
  chapterHref: string,
  text: string,
  day: number,
  color: Highlight["color"] = "yellow",
): Highlight => ({
  id,
  bookId: book.id,
  type: "highlight",
  color,
  cfiRange: `epubcfi(/6/4!/4[${id}])`,
  chapterHref,
  text,
  createdAt: at(day),
  updatedAt: at(day),
});
const note = (id: string, chapterHref: string, text: string, content: string, day: number): Note => ({
  id,
  bookId: book.id,
  type: "note",
  cfiRange: `epubcfi(/6/6!/4[${id}])`,
  chapterHref,
  text,
  content,
  createdAt: at(day),
  updatedAt: at(day),
});

/** Four highlights and two notes across the book's three parts. */
export const sampleMarks: (Highlight | Note)[] = [
  highlight("h1", "foreword.xhtml", "Pale Fire, a poem in heroic couplets, of nine hundred ninety-nine lines.", 2),
  highlight(
    "h2",
    "poem.xhtml",
    "I was the shadow of the waxwing slain / By the false azure in the windowpane.",
    5,
    "blue",
  ),
  highlight(
    "h3",
    "poem.xhtml",
    "And through the flowing shade and ebbing light / A man, unheedful of the butterfly.",
    9,
  ),
  note(
    "n1",
    "poem.xhtml",
    "Life is a message scribbled in the dark.",
    "The line the whole commentary keeps circling back to.",
    12,
  ),
  highlight("h4", "commentary.xhtml", "Without her and without the poem, I would be completely alone.", 20, "pink"),
  note("n2", "commentary.xhtml", "Resembles a Zemblan.", "Kinbote reads himself into every stanza.", 24),
];

/** The marks as the container hands them over, with inert handlers. */
export function marksState(overrides: Partial<BookDetailsMarks> = {}): BookDetailsMarks {
  return {
    marks: sampleMarks,
    isLoading: false,
    loadFailed: false,
    chapters,
    retry: () => {},
    openPassage: () => {},
    remove: () => {},
    ...overrides,
  };
}
