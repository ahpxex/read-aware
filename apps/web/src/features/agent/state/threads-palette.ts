import { atom } from "jotai";

/**
 * Whether the Agent page's thread palette is open. Held above the page: the
 * header's Threads button opens it (inline, or from the dots menu when the
 * header has folded it away), and the page renders it.
 */
export const threadsPaletteOpenAtom = atom(false);
