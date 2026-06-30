import type { ChatTransport } from "./chat-transport";
import type { ChatStreamChunk, ChatTurnRequest } from "./chat-types";

/**
 * A local, offline stand-in for the real assistant backend. It streams a
 * believable, Markdown-formatted reply so the entire chat UI — streaming,
 * stop, attachments, Markdown rendering — can be built and demoed before the
 * agent backend exists. Swap it out via `setChatTransport`.
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
      yield { type: "status", status: "Thinking…" };
      await sleep(450, signal);
      if (signal?.aborted) return;

      const reply = composeReply(request);
      // Stream word-by-word so the typing animation and stop button are exercised.
      for (const token of tokenize(reply)) {
        if (signal?.aborted) return;
        yield { type: "text", text: token };
        await sleep(14, signal);
      }
    },
  };
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
  lines.push(
    "Tell me which thread to follow and I'll go deeper, or highlight another passage to bring it into the conversation.",
  );
  lines.push("");
  lines.push(
    "_Note: this is a simulated local reply. Real answers — grounded in the book and your notes — arrive once the assistant backend is connected._",
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
