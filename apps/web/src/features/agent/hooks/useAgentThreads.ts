import { useCallback, useEffect, useState } from "react";
import { useAtom } from "jotai";
import type { ThreadSummary } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { userDomain } from "../../../domain";
import { describeError, useTranslation, type ErrorDescription } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { activeGlobalThreadAtom, newGlobalThreadId } from "../../ai";

const log = createLogger("threads");

export type AgentThreads = {
  threads: ThreadSummary[];
  isLoading: boolean;
  /** The list could not be read: an error, never "no conversations". */
  loadFailure: ErrorDescription | null;
  retry: () => void;
  activeThreadId: string;
  select: (threadId: string) => void;
  remove: (threadId: string) => void;
};

/**
 * The global threads, kept current while the list is on screen: re-read
 * whenever a conversation changes (a new thread's first turn commits, a
 * thread is cleared here or elsewhere), not only when the list opens.
 *
 * Deleting clears the thread's messages (the list shows non-empty threads
 * only, so it drops out); deleting the open thread moves to the next one, or
 * to a fresh thread when none is left.
 */
export function useAgentThreads(): AgentThreads {
  const { t } = useTranslation("ai");
  const { toast } = useToast();
  const [activeThreadId, setActiveThreadId] = useAtom(activeGlobalThreadAtom);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<ErrorDescription | null>(null);
  const [request, setRequest] = useState(0);
  const retry = useCallback(() => setRequest((value) => value + 1), []);

  useEffect(() => {
    const lifetime = new AbortController();
    const conversations = userDomain.conversations;
    // Reads can overlap (the first one and a change's re-read); only the
    // latest one started may land, so a slow older read never overwrites it.
    let latest = 0;
    const load = async () => {
      const read = ++latest;
      const current = () => !lifetime.signal.aborted && read === latest;
      try {
        const next = await conversations.queries.listThreads();
        if (!current()) return;
        setThreads(next);
        setLoadFailure(null);
      } catch (error) {
        if (!current()) return;
        log.warn("Listing conversations failed", error);
        setLoadFailure(describeError(error));
      } finally {
        if (current()) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const stop = conversations.events.observeInvalidation(load);
    return () => {
      lifetime.abort();
      stop();
    };
  }, [request]);

  const remove = useCallback(
    (threadId: string) => {
      const remaining = threads.filter((thread) => thread.id !== threadId);
      userDomain.conversations.commands.clear({ kind: "global", id: threadId }).then(
        () => {
          setThreads((current) => current.filter((thread) => thread.id !== threadId));
          if (threadId === activeThreadId) setActiveThreadId(remaining[0]?.id ?? newGlobalThreadId());
        },
        (error: unknown) => {
          log.warn("Could not clear conversation", error);
          toast({ variant: "destructive", title: t("agent.threads.delete"), description: describeError(error).body });
        },
      );
    },
    [activeThreadId, setActiveThreadId, t, threads, toast],
  );

  return {
    threads,
    isLoading,
    loadFailure,
    retry,
    activeThreadId,
    select: setActiveThreadId,
    remove,
  };
}
