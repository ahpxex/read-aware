export type BookFormat = "epub";

export type ReadingStatus = "unread" | "reading" | "finished";

export type EpubProgress = {
  format: "epub";
  currentLocation: number;
  totalLocations: number;
  progressPercent: number;
  cfi: string | null;
  href: string | null;
};

export type BookProgress = EpubProgress | null;

export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  fileName: string;
  mimeType: string;
  fileSize: number;
  coverUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  progressPercent: number;
  readingStatus: ReadingStatus;
  progress: BookProgress;
}

export interface StoredBookFile {
  bookId: string;
  blob: Blob;
}

export type ShelfSection = {
  label: string;
  books: LibraryBook[];
};
