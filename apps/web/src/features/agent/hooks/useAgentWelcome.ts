import { useEffect, useState } from "react";
import { userDomain } from "../../../domain";
import { useLocale, type AppLocale } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { conversationLocale } from "../lib/conversation-locale";
import {
  pickWelcomeGreeting,
  pickWelcomeSuggestions,
  type WelcomeGreetingKey,
  type WelcomeSuggestionKey,
} from "../lib/welcome-suggestions";

const log = createLogger("agent-welcome");

export type AgentWelcomeState = {
  greeting: WelcomeGreetingKey;
  suggestions: WelcomeSuggestionKey[];
  /** The language the reader writes to the agent in: the prompts are offered in it. */
  promptLocale: AppLocale;
};

/**
 * What the empty Agent page offers: a fresh heading and mix of ways in for
 * each conversation (held while it stays open), and the language to offer the
 * prompts in, read from the reader's own recent messages to the agent (the
 * threads' titles are their first messages). Until those are read — or if the
 * read fails — the prompts follow the interface language.
 */
export function useAgentWelcome(threadId: string): AgentWelcomeState {
  const interfaceLocale = useLocale();
  const [picks, setPicks] = useState(() => ({
    threadId,
    greeting: pickWelcomeGreeting(),
    suggestions: pickWelcomeSuggestions(4),
  }));
  if (picks.threadId !== threadId)
    setPicks({ threadId, greeting: pickWelcomeGreeting(), suggestions: pickWelcomeSuggestions(4) });

  const [recentMessages, setRecentMessages] = useState<string[]>([]);
  useEffect(() => {
    let current = true;
    userDomain.conversations.queries.listThreads().then(
      (threads) => {
        if (!current) return;
        const newestFirst = [...threads].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
        setRecentMessages(newestFirst.map((thread) => thread.title ?? "").filter(Boolean));
      },
      (error: unknown) => {
        // Only the prompts' language depends on this; they stay in the interface language.
        if (current) log.warn("Reading recent conversations for the welcome's language failed", error);
      },
    );
    return () => {
      current = false;
    };
  }, [threadId]);

  return {
    greeting: picks.greeting,
    suggestions: picks.suggestions,
    promptLocale: conversationLocale(recentMessages, interfaceLocale),
  };
}
