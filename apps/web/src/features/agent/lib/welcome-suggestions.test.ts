import { expect, test } from "bun:test";
import {
  pickWelcomeGreeting,
  pickWelcomeSuggestions,
  WELCOME_GREETINGS,
  WELCOME_SUGGESTIONS,
} from "./welcome-suggestions";

const themeOf = (key: string) =>
  Object.entries(WELCOME_SUGGESTIONS).find(([, keys]) => (keys as readonly string[]).includes(key))?.[0];

/** A seeded source, so a run is repeatable. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

test("each pick draws its prompts from that many different themes", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const picked = pickWelcomeSuggestions(4, seeded(seed));
    expect(picked).toHaveLength(4);
    expect(new Set(picked.map(themeOf)).size).toBe(4);
  }
});

test("over many picks every prompt turns up, so the page does not show the same four", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 500; seed++) for (const key of pickWelcomeSuggestions(4, seeded(seed))) seen.add(key);
  expect([...seen].sort()).toEqual(Object.values(WELCOME_SUGGESTIONS).flat().sort());
});

test("the edges of the random source stay in range", () => {
  expect(pickWelcomeSuggestions(4, () => 0)).toHaveLength(4);
  expect(pickWelcomeSuggestions(4, () => 0.999_999)).toHaveLength(4);
  expect(pickWelcomeSuggestions(9, () => 0.5)).toHaveLength(Object.keys(WELCOME_SUGGESTIONS).length);
});

test("every greeting can be drawn, and the edges of the source stay in range", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 200; seed++) seen.add(pickWelcomeGreeting(seeded(seed)));
  expect([...seen].sort()).toEqual([...WELCOME_GREETINGS].sort());
  expect(WELCOME_GREETINGS).toContain(pickWelcomeGreeting(() => 0));
  expect(WELCOME_GREETINGS).toContain(pickWelcomeGreeting(() => 0.999_999));
});
