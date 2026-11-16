import { useState } from "react";
import {
  pickWelcomeGreeting,
  pickWelcomeSuggestions,
  type WelcomeGreetingKey,
  type WelcomeSuggestionKey,
} from "../lib/welcome-suggestions";

export type AgentWelcomeState = {
  greeting: WelcomeGreetingKey;
  suggestions: WelcomeSuggestionKey[];
};

/**
 * What the empty Agent page offers: a fresh heading and mix of ways in for
 * each conversation, held while it stays open.
 */
export function useAgentWelcome(threadId: string): AgentWelcomeState {
  const [picks, setPicks] = useState(() => ({
    threadId,
    greeting: pickWelcomeGreeting(),
    suggestions: pickWelcomeSuggestions(4),
  }));
  if (picks.threadId !== threadId)
    setPicks({ threadId, greeting: pickWelcomeGreeting(), suggestions: pickWelcomeSuggestions(4) });
  return { greeting: picks.greeting, suggestions: picks.suggestions };
}
