import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorCode } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { readingRuntime } from "../../../domain/reading-runtime";
import { describeError } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { createPageMemory, jumpReturnAfter, type JumpReturn } from "../lib/jump-return";
import { goToReadingTarget } from "../lib/reader-bookmarks";
import type { ReadingCursor } from "../lib/reader-types";

const log = createLogger("jump-return");

/**
 * The way back offered after a jump in the open book (see lib/jump-return):
 * the place the reading stopped at, until the reader takes it, dismisses it
 * or steps through the jump history themselves. It belongs to one reading
 * session, so it is gone when the book closes.
 *
 * `cursor` is the reader's live position report; the page it names for a
 * place is the page the way back to that place is labelled with.
 */
export function useJumpReturn(cursor: ReadingCursor | null): {
  origin: JumpReturn | null;
  goBack: () => void;
  dismiss: () => void;
} {
  const { toast } = useToast();
  const [pages] = useState(createPageMemory);
  useLayoutEffect(() => pages.remember(cursor), [pages, cursor]);
  const [offer, setOffer] = useState<JumpReturn | null>(null);
  const [sessionId, setSessionId] = useState(() => readingRuntime.snapshot().sessionId);
  useEffect(() => readingRuntime.observe((session) => setSessionId(session.sessionId)), []);

  // Going back is itself a jump; it must not offer a way back to where it left.
  const returning = useRef(false);
  useEffect(
    () =>
      readingRuntime.observeHistory((move) => {
        if (!returning.current) setOffer((current) => jumpReturnAfter(current, move, pages.pageAt));
      }),
    [pages],
  );

  const origin = offer && offer.sessionId === sessionId ? offer : null;
  const goBack = useCallback(() => {
    if (!origin || returning.current) return;
    returning.current = true;
    setOffer(null);
    goToReadingTarget(origin.location)
      .catch((error: unknown) => {
        // A newer jump replaced this one: the reader is already elsewhere by choice.
        if (errorCode(error) === "reader/superseded") return;
        log.error("returning to the place before a jump failed", error);
        const failure = describeError(error);
        toast({ variant: "destructive", description: failure.body });
        // Offer it again only where trying again can work.
        if (failure.retryable) setOffer((current) => current ?? origin);
      })
      .finally(() => {
        returning.current = false;
      });
  }, [origin, toast]);
  const dismiss = useCallback(() => setOffer(null), []);

  return { origin, goBack, dismiss };
}
