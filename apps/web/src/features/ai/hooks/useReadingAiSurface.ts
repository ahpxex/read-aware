import { useEffect, useLayoutEffect, useRef } from "react";
import { readingAiActions } from "../../../services/reading-ai-runtime";
import type { BookConversation } from "./useBookConversation";

/** A prepared action uses the same send/persist/retry path as the book composer. */
export function useReadingAiSurface(bookId: string, conversation: Pick<BookConversation, "send" | "isLoading" | "isStreaming">) {
  const current = useRef(conversation);
  useLayoutEffect(() => { current.current = conversation; readingAiActions.flush(bookId); });
  useEffect(() => readingAiActions.bind(bookId, { send: context => {
    const chat = current.current;
    if (chat.isLoading) return "loading";
    if (chat.isStreaming) return "busy";
    return chat.send(context.prompt, context.selection ? [{ kind: "selection", ...context.selection }] : undefined) ? "started" : "busy";
  } }), [bookId]);
}
