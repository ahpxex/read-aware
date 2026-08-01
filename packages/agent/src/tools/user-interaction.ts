import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import type {
  RuntimeDeps,
  UserInteractionAnswer,
  UserInteractionRequest,
} from "../ports";

export const INTERACTIVE_TOOL_NAMES = [
  "ask_user",
  "delete_book",
  "delete_collection",
  "delete_annotation",
] as const;

export type UserInteractionToolDetails =
  | {
      type: "user-interaction";
      phase: "request";
      request: UserInteractionRequest;
    }
  | {
      type: "user-interaction";
      phase: "response";
      id: string;
      answer: UserInteractionAnswer;
    };

type WithoutInteractionIdentity<T> = T extends unknown
  ? Omit<T, "id" | "threadKey">
  : never;

type UserInteractionRequestInput = WithoutInteractionIdentity<UserInteractionRequest>;

function partialResult(
  details: UserInteractionToolDetails,
): AgentToolResult<UserInteractionToolDetails> {
  return { content: [], details };
}

export function interactionFromToolDetails(
  value: unknown,
): UserInteractionToolDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  const details = value as Partial<UserInteractionToolDetails>;
  if (details.type !== "user-interaction") return undefined;
  if (details.phase === "request" && details.request) {
    return details as Extract<UserInteractionToolDetails, { phase: "request" }>;
  }
  if (details.phase === "response" && details.id && details.answer) {
    return details as Extract<UserInteractionToolDetails, { phase: "response" }>;
  }
  return undefined;
}

/**
 * Register the suspension before publishing the request. That ordering closes
 * the tiny race where a very fast UI answer could arrive before the resolver
 * existed. The same response details are returned for final-event recovery;
 * appendStreamChunk treats the duplicate as an idempotent update.
 */
export async function requestUserInteraction(input: {
  deps: RuntimeDeps;
  toolCallId: string;
  threadKey: string;
  request: UserInteractionRequestInput;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<UserInteractionToolDetails>;
}): Promise<{
  answer: UserInteractionAnswer;
  details: Extract<UserInteractionToolDetails, { phase: "response" }>;
}> {
  const request = {
    ...input.request,
    id: `${input.threadKey}:${input.toolCallId}`,
    threadKey: input.threadKey,
  } as UserInteractionRequest;
  const answerPromise = input.deps.interactions.request(request, input.signal);
  input.onUpdate?.(
    partialResult({ type: "user-interaction", phase: "request", request }),
  );
  const answer = await answerPromise;
  const details = {
    type: "user-interaction" as const,
    phase: "response" as const,
    id: request.id,
    answer,
  };
  input.onUpdate?.(partialResult(details));
  return { answer, details };
}
