export const READING_AI_ACTIONS = ["explainSelection", "defineTerm", "translate", "summarizeChapter"] as const;
export type ReadingAiAction = typeof READING_AI_ACTIONS[number];
export type ReadingAiContext = {
  action: ReadingAiAction;
  bookId: string;
  prompt: string;
  selection?: { text: string; cfiRange: string | null; chapterHref: string | null };
};
export type ReadingAiResult = { status: "started"; action: ReadingAiAction; bookId: string }
  | { status: "context"; context: ReadingAiContext };
export type ReadingAiPort = {
  enabled(): readonly ReadingAiAction[];
  /** A book thread answers from context in its own turn, never recursively sends to itself. */
  run(action: ReadingAiAction, answeringBookId?: string, signal?: AbortSignal): Promise<ReadingAiResult>;
};
