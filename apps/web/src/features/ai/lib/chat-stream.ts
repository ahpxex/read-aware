import type {
  ChatAssistantPart,
  ChatReference,
  ChatStreamChunk,
} from "./chat-types";

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
          {
            type: "tool",
            id: chunk.id,
            tool: chunk.tool,
            detail: chunk.detail,
            input: chunk.input,
            state: "running",
          },
        ];
      }
      if (chunk.phase === "update") {
        return parts.map((part) =>
          part.type === "tool" && part.id === chunk.id && part.state === "running"
            ? { ...part, output: chunk.output }
            : part,
        );
      }
      return parts.map((part) =>
        part.type === "tool" && part.id === chunk.id && part.state === "running"
          ? {
              ...part,
              output: chunk.output,
              state: chunk.isError ? "error" : "done",
            }
          : part,
      );
    }
    case "interaction": {
      if (chunk.phase === "request") {
        if (parts.some((part) => part.type === "interaction" && part.id === chunk.request.id)) {
          return parts;
        }
        return [
          ...parts,
          {
            type: "interaction",
            id: chunk.request.id,
            request: chunk.request,
            state: "pending",
          },
        ];
      }
      return parts.map((part) =>
        part.type === "interaction" && part.id === chunk.id
          ? {
              ...part,
              state: chunk.answer.cancelled ? "cancelled" : "answered",
              answer: chunk.answer,
            }
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
    .filter((part) => {
      if (part.type === "text" || part.type === "thinking") return part.text.trim().length > 0;
      return true;
    })
    .map((part) => {
      if (part.type === "tool" && part.state === "running") {
        return { ...part, state: "done" };
      }
      if (part.type === "interaction" && part.state === "pending") {
        return {
          ...part,
          state: "cancelled",
          answer: { cancelled: true },
        };
      }
      return part;
    });
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
const TRACE_MAX_CHARS = 8_000;

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
  if (typeof record.name === "string" && record.name.trim()) return truncate(record.name);
  if (typeof record.title === "string" && record.title.trim()) return truncate(record.title);
  // Any tool with a `term` argument (dictionary-style look-ups, plugin or
  // built-in) shows the term — it is the human-meaningful bit.
  if (typeof record.term === "string" && record.term.trim()) {
    return truncate(record.term);
  }
  return undefined;
}

/**
 * Serialize one tool-trace value into bounded, readable text. Tool results are
 * often JSON strings already, so parse and pretty-print those before storing
 * them in the presentation-only `parts_json` column. The cap prevents chapter
 * reads and plugin responses from quietly bloating every chat message.
 */
export function toolTraceText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  let normalized = value;
  if (typeof value === "string") {
    if (!value.trim()) return undefined;
    try {
      normalized = JSON.parse(value);
    } catch {
      normalized = value;
    }
  }

  let text: string;
  if (typeof normalized === "string") {
    text = normalized;
  } else {
    try {
      text = JSON.stringify(normalized, null, 2);
    } catch {
      text = String(normalized);
    }
  }
  if (!text.trim()) return undefined;
  return text.length > TRACE_MAX_CHARS ? `${text.slice(0, TRACE_MAX_CHARS)}\n…` : text;
}
