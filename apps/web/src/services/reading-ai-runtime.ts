import { getDefaultStore } from "jotai";
import { aiPreferencesAtom } from "../state/ui";
import { readingRuntime } from "../domain/reading-runtime";
import { getExtractedChapters } from "../domain/library";
import { readBookRange } from "../features/library/lib/book-range";
import { hrefMatches } from "../features/reader/lib/epub-utils";
import { i18n } from "../i18n/instance";
import { readingAiPrompt } from "../features/ai/lib/reading-ai-prompts";
import { readerPanels } from "./reader-panels";
import { ReadingAiActions } from "./reading-ai-actions";

const store = getDefaultStore();
export const readingAiActions = new ReadingAiActions({
  preferences: () => store.get(aiPreferencesAtom),
  snapshot: () => readingRuntime.snapshot(),
  readRange: readBookRange,
  chapter: async (bookId, href, signal) => {
    signal?.throwIfAborted();
    const chapters = await getExtractedChapters(bookId);
    signal?.throwIfAborted();
    const index = chapters.findIndex(chapter => chapter.hrefs?.some(candidate => hrefMatches(candidate, href)));
    return index < 0 ? undefined : index;
  },
  prompt: (action, index) => readingAiPrompt(i18n.language, action, index),
  openChat: (bookId, sessionId, signal) => readerPanels.setPanel("chat", true, signal, { bookId, sessionId }),
  observe: handler => {
    const stopSettings = store.sub(aiPreferencesAtom, handler), stopReader = readingRuntime.observe(handler);
    return () => { stopSettings(); stopReader(); };
  },
});
