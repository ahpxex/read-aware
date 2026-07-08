import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useAtomValue } from "jotai";
import { aiPreferencesAtom } from "../../../state/ui";
import type { ChatAssistantPart, ChatMessage } from "../lib/chat-types";

/** Breathing room between the viewport top and the pinned user message. */
const TURN_TOP_GAP = 16;
/** Top gap + the transcript's own bottom padding, subtracted from the spacer. */
const LIVE_TURN_INSET = 32;
/** Within this distance of the bottom, a user scroll re-engages following. */
const REENGAGE_THRESHOLD = 48;

interface TranscriptAutoScrollOptions {
  messages: ChatMessage[];
  streamingParts: ChatAssistantPart[];
  isStreaming: boolean;
  isLoading: boolean;
}

export interface TranscriptAutoScroll {
  /** Attach to the ScrollArea — the scrollable node itself. */
  containerRef: (node: HTMLDivElement | null) => void;
  /** Attach to the live-turn wrapper (last user message + in-flight reply). */
  liveTurnRef: RefObject<HTMLDivElement | null>;
  /** Id of the user message that opened the live turn, or null when settled. */
  liveTurnId: string | null;
  /**
   * min-height for the live-turn wrapper. Only set in anchored mode (the
   * default): it reserves a viewport of space below the question so the reply
   * streams into view without any scrolling. Undefined in follow mode.
   */
  liveTurnMinHeight: number | undefined;
}

/**
 * Scroll policy for the chat transcript, in two modes per the `followStreaming`
 * preference:
 *
 * - **Anchored (default)**: one scroll on send pins the question to the top of
 *   the viewport (the wrapper's min-height reserves the space below); the reply
 *   then streams in place — nobody reads at token speed, so the view stays on
 *   its first lines.
 * - **Follow**: keep the newest text in view, but any user scroll-up hands
 *   control back immediately; scrolling back to the bottom re-engages.
 */
export function useTranscriptAutoScroll({
  messages,
  streamingParts,
  isStreaming,
  isLoading,
}: TranscriptAutoScrollOptions): TranscriptAutoScroll {
  const follow = useAtomValue(aiPreferencesAtom).followStreaming;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const detachScrollListenerRef = useRef<(() => void) | null>(null);
  const liveTurnRef = useRef<HTMLDivElement | null>(null);
  const [liveTurn, setLiveTurn] = useState<{ id: string; minHeight: number } | null>(null);
  const liveTurnIdRef = useRef<string | null>(null);
  // Follow-mode engagement: cleared the moment the user scrolls up, restored
  // when they return to the bottom or send a new message.
  const engagedRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  // The scroll listener attaches via callback ref because the ScrollArea
  // mounts late (after the loading / empty early returns).
  const attachContainer = useCallback((node: HTMLDivElement | null) => {
    detachScrollListenerRef.current?.();
    detachScrollListenerRef.current = null;
    containerRef.current = node;
    if (!node) return;
    lastScrollTopRef.current = node.scrollTop;
    const onScroll = () => {
      const previous = lastScrollTopRef.current;
      const top = node.scrollTop;
      lastScrollTopRef.current = top;
      // Our own scrolls only ever move down; an upward move is the user.
      if (top < previous - 1) {
        engagedRef.current = false;
        return;
      }
      if (node.scrollHeight - top - node.clientHeight < REENGAGE_THRESHOLD) {
        engagedRef.current = true;
      }
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    detachScrollListenerRef.current = () => node.removeEventListener("scroll", onScroll);
  }, []);

  // Conversation (re)load — jump straight to the latest turns; a switch of
  // books also dissolves the previous live turn.
  const wasLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      liveTurnIdRef.current = null;
      setLiveTurn(null);
      engagedRef.current = true;
      // Same commit mounted the ScrollArea with the loaded messages, so the
      // jump can happen right here — no frame to wait for.
      const container = containerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading]);

  // Turn start: the just-sent user message becomes the live turn.
  const lastMessage = messages[messages.length - 1];
  const sentUserId = isStreaming && lastMessage?.role === "user" ? lastMessage.id : null;
  useEffect(() => {
    if (!sentUserId || sentUserId === liveTurnIdRef.current) return;
    liveTurnIdRef.current = sentUserId;
    engagedRef.current = true;
    const container = containerRef.current;
    setLiveTurn({
      id: sentUserId,
      minHeight: container ? Math.max(0, container.clientHeight - LIVE_TURN_INSET) : 0,
    });
  }, [sentUserId]);

  // …then scroll it into place in a second effect: this one runs after the
  // commit that rendered the wrapper, so the min-height is already laid out
  // (a rAF from the effect above races that commit and can fire too early).
  // Anchored mode pins the question to the viewport top — the reserved space
  // below is where the reply lands; follow mode simply goes to the bottom.
  useEffect(() => {
    if (!liveTurn) return;
    const scroller = containerRef.current;
    if (!scroller) return;
    if (follow) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
      return;
    }
    const turn = liveTurnRef.current;
    if (!turn) return;
    const turnTop =
      turn.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top: turnTop - TURN_TOP_GAP, behavior: "smooth" });
  }, [liveTurn, follow]);

  // Follow mode: track the reply as it streams, unless the user took over.
  useEffect(() => {
    if (!follow || !isStreaming || !engagedRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [follow, isStreaming, streamingParts, messages]);

  return {
    containerRef: attachContainer,
    liveTurnRef,
    liveTurnId: liveTurn?.id ?? null,
    liveTurnMinHeight: follow ? undefined : liveTurn?.minHeight,
  };
}
