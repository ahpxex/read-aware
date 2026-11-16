/**
 * The ways into an empty Agent conversation, by theme. Each prompt is
 * something the agent can answer from what it can reach: reading progress
 * and time, the shelf and collections, highlights and notes, its memory of the
 * reader, and the web. Keys name catalog entries (`ai:agent.welcome.suggestions.<key>`).
 */
export const WELCOME_SUGGESTIONS = {
  reading: ["readingMonth", "unfinished", "slowest"],
  ideas: ["connect", "disagree", "highlightThemes", "notesReview"],
  shelf: ["organize", "nextRead", "shelfTour"],
  you: ["memory", "curiosity"],
  outward: ["reviews", "author"],
} as const;

export type WelcomeSuggestionKey = (typeof WELCOME_SUGGESTIONS)[keyof typeof WELCOME_SUGGESTIONS][number];

/**
 * `count` prompts from as many different themes, chosen with `random` (a
 * [0, 1) source, injectable for tests): the themes in a shuffled order, one
 * prompt from each.
 */
export function pickWelcomeSuggestions(count: number, random: () => number = Math.random): WelcomeSuggestionKey[] {
  const themes = Object.values(WELCOME_SUGGESTIONS) as ReadonlyArray<readonly WelcomeSuggestionKey[]>;
  const order = [...themes];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order.slice(0, count).map((prompts) => prompts[Math.floor(random() * prompts.length)]!);
}

/** Heading and line pairs for the empty Agent page (`ai:agent.welcome.greetings.<key>.{title,description}`). */
export const WELCOME_GREETINGS = ["explore", "mind", "across", "thread", "think"] as const;

export type WelcomeGreetingKey = (typeof WELCOME_GREETINGS)[number];

export function pickWelcomeGreeting(random: () => number = Math.random): WelcomeGreetingKey {
  return WELCOME_GREETINGS[Math.floor(random() * WELCOME_GREETINGS.length)]!;
}
