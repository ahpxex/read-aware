import type {
  ChatAssistantPart,
  ChatReference,
  ChatStreamChunk,
  ChatToolPart,
} from "./chat-types";

/**
 * Render-shaping for a settled assistant message: runs of ≥2 consecutive tool
 * parts fold into one group (a single quiet row stays as it is). Streaming
 * turns skip this — the live rows ARE the intermediate process the reader
 * watches; folding happens when the message settles.
 */
export type AssistantRenderItem =
  | { kind: "part"; part: ChatAssistantPart; index: number }
  | { kind: "tool-group"; parts: ChatToolPart[] };

export function groupSettledParts(parts: ChatAssistantPart[]): AssistantRenderItem[] {
  const items: AssistantRenderItem[] = [];
  let run: Array<{ part: ChatToolPart; index: number }> = [];
  const flush = () => {
    if (run.length >= 2) {
      items.push({ kind: "tool-group", parts: run.map((entry) => entry.part) });
    } else {
      for (const entry of run) items.push({ kind: "part", part: entry.part, index: entry.index });
    }
    run = [];
  };
  parts.forEach((part, index) => {
    if (part.type === "tool") {
      run.push({ part, index });
      return;
    }
    flush();
    items.push({ kind: "part", part, index });
  });
  flush();
  return items;
}

/**
 * "Never present the same item twice in one reply" is a stated tool rule, but
 * the model can slip (e.g. calling lookup_word twice for one word). This is
 * the mechanical guarantee: drop items already shown by an earlier reference
 * part of the same turn; a fully-duplicate stack appends nothing.
 */
function dedupeReference(
  parts: ChatAssistantPart[],
  reference: ChatReference,
): ChatReference | undefined {
  const seen = new Set<string>();
  for (const part of parts) {
    if (part.type !== "reference") continue;
    if (part.reference.kind === "books") {
      for (const book of part.reference.books) seen.add(`book:${book.bookId}`);
    } else {
      for (const word of part.reference.words) {
        seen.add(`word:${word.language} ${word.term.toLowerCase()}`);
      }
    }
  }
  if (reference.kind === "books") {
    const books = reference.books.filter((book) => !seen.has(`book:${book.bookId}`));
    return books.length > 0 ? { kind: "books", books } : undefined;
  }
  const words = reference.words.filter(
    (word) => !seen.has(`word:${word.language} ${word.term.toLowerCase()}`),
  );
  return words.length > 0 ? { kind: "words", words } : undefined;
}

/**
 * Pure assembly of the assistant turn: folds transport chunks into the ordered
 * part timeline the UI renders. Immutable — every call returns a fresh array
 * (with the touched part copied) so it can back a React state update directly.
 */
export function appendStreamChunk(
  parts: ChatAssistantPart[],
  chunk: ChatStreamChunk,
): ChatAssistantPart[] {
  switch (chunk.type) {
    case "text":
    case "thinking": {
      const last = parts[parts.length - 1];
      if (last && last.type === chunk.type) {
        return [...parts.slice(0, -1), { ...last, text: last.text + chunk.text }];
      }
      return [...parts, { type: chunk.type, text: chunk.text }];
    }
    case "tool": {
      if (chunk.phase === "start") {
        return [
          ...parts,
          { type: "tool", id: chunk.id, tool: chunk.tool, detail: chunk.detail, state: "running" },
        ];
      }
      return parts.map((part) =>
        part.type === "tool" && part.id === chunk.id && part.state === "running"
          ? { ...part, state: chunk.isError ? "error" : "done" }
          : part,
      );
    }
    case "reference": {
      // One part per producing tool call, idempotent by id; stacks never merge.
      if (parts.some((part) => part.type === "reference" && part.id === chunk.id)) return parts;
      const reference = dedupeReference(parts, chunk.reference);
      if (!reference) return parts;
      return [...parts, { type: "reference", id: chunk.id, reference }];
    }
    default:
      // `status` (and any future chunk kinds) don't shape the timeline.
      return parts;
  }
}

/**
 * Settle a timeline for persistence: tools still "running" (stopped or failed
 * mid-call) settle to "done" so no spinner is ever stored, and empty text runs
 * are dropped.
 */
export function finalizeParts(parts: ChatAssistantPart[]): ChatAssistantPart[] {
  return parts
    .filter(
      (part) =>
        part.type === "tool" || part.type === "reference" || part.text.trim().length > 0,
    )
    .map((part) =>
      part.type === "tool" && part.state === "running" ? { ...part, state: "done" } : part,
    );
}

/**
 * The plain-text reply projection: visible prose only (no thinking, no tool
 * trace), segments separated by a blank line. This is what `ChatMessage.content`
 * stores and what the agent's conversation history reads back.
 */
export function partsText(parts: ChatAssistantPart[]): string {
  return parts
    .filter((part): part is Extract<ChatAssistantPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

const DETAIL_MAX_CHARS = 80;

function truncate(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > DETAIL_MAX_CHARS ? `${clean.slice(0, DETAIL_MAX_CHARS - 1)}…` : clean;
}

/**
 * Distill a tool call's raw arguments into the one short string worth showing
 * next to its label — the search query, the sentence being remembered, the
 * chapter number. Anything opaque (book ids, flags) yields nothing.
 */
export function toolStepDetail(tool: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  if (typeof record.query === "string" && record.query.trim()) return truncate(record.query);
  if (tool === "remember" && typeof record.content === "string" && record.content.trim()) {
    return truncate(record.content);
  }
  if (tool === "read_chapter" && typeof record.chapterIndex === "number") {
    const part = typeof record.part === "number" && record.part > 0 ? ` · ${record.part + 1}` : "";
    return `#${record.chapterIndex}${part}`;
  }
  if (tool === "lookup_word" && typeof record.term === "string" && record.term.trim()) {
    return truncate(record.term);
  }
  return undefined;
}
