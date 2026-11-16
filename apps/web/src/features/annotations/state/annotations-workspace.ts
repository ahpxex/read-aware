import { atom } from "jotai";
import type { MarksFilter } from "../../reader";

/**
 * What the highlights & notes page is showing. Held above the page, for the
 * session only, so opening a passage in the reader and coming back returns to
 * the same book, filter and search rather than to every book's marks.
 */
export const annotationsWorkspaceBookAtom = atom<string | null>(null);
export const annotationsWorkspaceFilterAtom = atom<MarksFilter>("all");
export const annotationsWorkspaceQueryAtom = atom("");
