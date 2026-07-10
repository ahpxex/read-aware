import type { ChatTransport } from "./chat-transport";
import type { ChatReference, ChatStreamChunk, ChatTurnRequest } from "./chat-types";

/**
 * A local, offline stand-in for the real assistant backend. It streams a
 * believable turn — thinking, a couple of tool steps, then a Markdown reply
 * with a code block and a table — so the entire chat UI (streaming, stop,
 * attachments, the part timeline, Markdown rendering) can be built and demoed
 * before an API key is configured. Swap it out via `setChatTransport`.
 *
 * It is deliberately honest: the reply names itself a simulated placeholder so
 * no one mistakes it for a real model.
 */
export function createMockChatTransport(): ChatTransport {
  return {
    async *sendTurn(
      request: ChatTurnRequest,
      signal?: AbortSignal,
    ): AsyncIterable<ChatStreamChunk> {
      yield* streamText(
        "thinking",
        "The reader is asking about this book. Let me check the shelf and their highlights before answering.",
        signal,
      );
      if (signal?.aborted) return;

      yield* toolStep("list_books", undefined, 500, signal);
      yield* toolStep(
        "search_book_text",
        request.message.content.trim() || undefined,
        650,
        signal,
      );
      if (signal?.aborted) return;

      // Interleaving demo: prose → a book-card stack → prose → a word card,
      // exercising both card kinds and the snapshot fallback (in the browser
      // there is no shelf to hydrate from, so cards render their snapshots).
      yield* streamText("text", "Two books from your shelf speak to this directly:", signal);
      if (signal?.aborted) return;
      yield { type: "reference", id: crypto.randomUUID(), reference: mockBooks(request) };
      yield* streamText("text", composeReply(request), signal);
      if (signal?.aborted) return;
      yield { type: "reference", id: crypto.randomUUID(), reference: MOCK_WORD };
      yield* streamText(
        "text",
        "_“Serendipity” above is the kind of word card real lookups produce._",
        signal,
      );
    },
  };
}

function mockBooks(request: ChatTurnRequest): ChatReference {
  return {
    kind: "books",
    books: [
      { bookId: request.bookId, title: request.bookTitle || "This book" },
      { bookId: "mock-second-book", title: "A Second Sample Book", author: "Jane Author" },
    ],
  };
}

const MOCK_WORD: ChatReference = {
  kind: "words",
  words: [
    {
      term: "serendipity",
      language: "English",
      source: "lookup",
      entry: {
        headword: "serendipity",
        pronunciation: "/ˌsɛɹ.ənˈdɪp.ɪ.ti/",
        senses: [
          {
            partOfSpeech: "noun",
            definition:
              "The faculty of making fortunate discoveries by accident; a happy, unplanned finding.",
            examples: ["Meeting her at the library was pure serendipity."],
          },
          {
            partOfSpeech: "noun",
            definition: "An instance of such a discovery.",
            examples: [],
          },
        ],
        etymology:
          "Coined by Horace Walpole in 1754 after 'The Three Princes of Serendip', whose heroes kept making discoveries by accident.",
        contextualMeaning:
          "Here it names the pleasant surprise of stumbling onto exactly the right book.",
      },
    },
  ],
};

/** One start/end tool pair with a believable pause in between. */
async function* toolStep(
  tool: string,
  detail: string | undefined,
  ms: number,
  signal?: AbortSignal,
): AsyncIterable<ChatStreamChunk> {
  if (signal?.aborted) return;
  const id = crypto.randomUUID();
  yield { type: "tool", phase: "start", id, tool, detail };
  await sleep(ms, signal);
  yield { type: "tool", phase: "end", id, isError: false };
}

/** Stream a string word-by-word as text or thinking deltas. */
async function* streamText(
  kind: "text" | "thinking",
  content: string,
  signal?: AbortSignal,
): AsyncIterable<ChatStreamChunk> {
  for (const token of tokenize(content)) {
    if (signal?.aborted) return;
    yield { type: kind, text: token };
    await sleep(kind === "thinking" ? 24 : 14, signal);
  }
}

function composeReply(request: ChatTurnRequest): string {
  const passage = request.message.attachments?.find((a) => a.kind === "selection")?.text?.trim();
  const question = request.message.content.trim();
  const title = request.bookTitle || "this book";

  const lines: string[] = [];

  if (passage) {
    const quoted = passage.length > 220 ? `${passage.slice(0, 220)}…` : passage;
    lines.push(`Looking at this passage from **${title}**:`);
    lines.push("");
    lines.push(`> ${quoted}`);
    lines.push("");
  }

  if (question) {
    lines.push(`On your question — *“${question}”* — here's how I'd think about it:`);
  } else if (passage) {
    lines.push("A few threads worth pulling on:");
  } else {
    lines.push(`Happy to dig into **${title}** with you. A few directions we could take:`);
  }
  lines.push("");
  lines.push("- **What it's claiming** — the literal argument, stated plainly.");
  lines.push("- **Why it matters here** — how it connects to what you've read so far.");
  lines.push("- **Where to push back** — the assumption a careful reader would question.");
  lines.push("");
  lines.push("Reading structures like this side by side helps:");
  lines.push("");
  lines.push("| Thread | Where it shows up | Weight |");
  lines.push("| --- | --- | --- |");
  lines.push("| Claim | Opening chapters | High |");
  lines.push("| Evidence | Case studies | Medium |");
  lines.push("| Counterpoint | Footnotes, asides | Low |");
  lines.push("");
  lines.push("And if the book itself sketches a process, it often reads like pseudocode:");
  lines.push("");
  lines.push("```python");
  lines.push("def read_closely(chapter):");
  lines.push("    claims = extract_claims(chapter)");
  lines.push("    return [c for c in claims if worth_questioning(c)]");
  lines.push("```");
  lines.push("");
  lines.push(
    "Tell me which thread to follow and I'll go deeper, or highlight another passage to bring it into the conversation.",
  );
  lines.push("");
  lines.push(
    "_Note: this is a simulated local reply. Real answers — grounded in the book and your notes — arrive once an API key is configured._",
  );

  return lines.join("\n");
}

/** Split into whitespace-preserving tokens so streaming reads naturally. */
function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [text];
}

/** Resolve after `ms`, or immediately if the signal aborts — keeps stop snappy. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
