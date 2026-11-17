/**
 * The narrative reading fence, in one place. The host computes the fence for
 * each turn (thread.ts); every book-content tool asks `readingFence` whether a
 * call is bounded, and only the reader can open it, by approving the card that
 * `request_spoiler_access` raises. A tool argument never carries permission.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { obj, str } from "@earendil-works/pi-schema";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";
import type { AgentTurnState, SpoilerFence } from "./turn-state";
import { requestUserInteraction } from "./user-interaction";

export const SPOILER_ACCESS_TOOL = "request_spoiler_access";

/** How a refused call explains the boundary; every fenced tool says the same thing. */
export const BEYOND_READER_POSITION = `beyond the reader's position in this narrative book. If the reader is asking about later content, call ${SPOILER_ACCESS_TOOL} and retry once they approve; otherwise stay within the boundary.`;

/**
 * The fence a call on `bookId` must respect, or none: another book, a book
 * without plot protection, and a turn whose reader approved spoilers all read
 * freely.
 */
export function readingFence(
  scope: ThreadScope,
  turnState: AgentTurnState | undefined,
  bookId: string | undefined,
): SpoilerFence | undefined {
  if (scope.kind !== "book" || bookId !== scope.bookId || !turnState || turnState.spoilersAllowed) return undefined;
  return turnState.spoilerFence;
}

/** Whether the reader opened this turn to content past their position in `bookId`. */
export function spoilersAllowed(
  scope: ThreadScope,
  turnState: AgentTurnState | undefined,
  bookId: string | undefined,
): boolean {
  return scope.kind === "book" && bookId === scope.bookId && turnState?.spoilersAllowed === true;
}

const OPENED =
  "The reader approved. For the rest of this reply, read and search past their position directly and answer from that text, not from memory of the book.";

/**
 * Offered only while this turn's book is spoiler-protected. Asking is the model's call; the
 * answer is the reader's, through the host's permission card, and lasts for
 * this reply only. A decline is final for the reply, so the reader is asked at
 * most once.
 */
export function buildSpoilerAccessTools(
  scope: ThreadScope,
  deps: RuntimeDeps,
  turnState: AgentTurnState | undefined,
): AgentTool[] {
  if (scope.kind !== "book" || !turnState?.spoilerProtected) return [];
  return [
    {
      name: SPOILER_ACCESS_TOOL,
      label: "Ask to reveal later content",
      executionMode: "sequential",
      description:
        "Ask the reader, through an in-chat card, to let this reply use content past their reading position in this narrative book. Call it only when the reader asks about what happens later, or when answering would need text past their position: never to widen a clamped search, verify a clue, or 'just in case'. The reader decides; their approval lasts for this reply only, and once they decline, stay within the boundary for the rest of it. In the same batch, put this call before the reads that need it.",
      parameters: obj({
        topic: str({
          minLength: 1,
          maxLength: 200,
          description:
            "What the reader would learn, in their language and without revealing it, e.g. 'how the trial ends' or 'who the narrator really is'.",
        }),
      }),
      execute: async (toolCallId, params, signal, onUpdate) => {
        if (turnState.spoilersAllowed) return textResult({ allowed: true, note: OPENED });
        if (turnState.spoilerAccessDeclined)
          return textResult({
            allowed: false,
            note: "The reader already declined in this reply. Do not ask again; answer within their position.",
          });
        const topic = (params as { topic: string }).topic.trim();
        if (!topic) throw new Error("topic must not be empty");
        const { answer, details } = await requestUserInteraction({
          deps,
          toolCallId,
          threadKey: threadScopeKey(scope),
          request: { kind: "permission", action: "reveal-spoilers", subject: topic },
          signal,
          onUpdate,
        });
        if (!answer.cancelled && answer.optionId === "approve") {
          turnState.spoilersAllowed = true;
          return { ...textResult({ allowed: true, note: OPENED }), details };
        }
        turnState.spoilerAccessDeclined = true;
        return {
          ...textResult({
            allowed: false,
            note: "The reader declined. Answer within their position, without naming, hinting at or negating what lies past it, and do not ask again in this reply.",
          }),
          details,
        };
      },
    },
  ];
}
