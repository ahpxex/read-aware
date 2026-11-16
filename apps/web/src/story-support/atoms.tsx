/**
 * Jotai seeding for Storybook.
 *
 * Several surfaces take no props at all — they read their state from atoms
 * (the software-update phase, the reading-stats store, the plugin registry).
 * Rendering those against jotai defaults would give one story per component
 * and it would always be the empty one. `withAtoms` hands a story its own
 * store, pre-set, so each state gets a real story without the component
 * having to grow a prop it doesn't want.
 *
 * A nested Provider wins over the one in `.storybook/preview`, and a fresh
 * store per mount keeps stories from leaking state into each other.
 *
 * This is story-only support code; nothing in the product imports it.
 */
import { useState, type ReactNode } from "react";
import { createStore, Provider, type WritableAtom } from "jotai";
import type { Decorator } from "@storybook/react-vite";
import { storyDisplayKey, storyDisplaySeed, type StoryGlobals } from "./display";

type JotaiStore = ReturnType<typeof createStore>;

/** One atom paired with the value to seed it with, type-checked together. */
export type AtomSeed = <TResult>(
  apply: <TValue>(atom: WritableAtom<unknown, [TValue], unknown>, value: TValue) => TResult,
) => TResult;

/**
 * Pair a writable atom with a value for `withAtoms`. The callback form is what
 * keeps the pairing honest — the value must match the atom's write type, which
 * a plain `[atom, value]` tuple in an array would widen away.
 */
export function seed<TValue>(atom: WritableAtom<unknown, [TValue], unknown>, value: TValue): AtomSeed {
  return (apply) => apply(atom, value);
}

/**
 * A decorator that renders the story against a fresh store with `seeds`
 * applied over the toolbar's display settings (`story-support/display`), so a
 * seeded story still follows the e-ink and motion toggles.
 */
export function withAtoms(...seeds: AtomSeed[]): Decorator {
  return (Story, context) => (
    <StoryStore key={storyDisplayKey(context.globals)} globals={context.globals} seeds={seeds}>
      <Story />
    </StoryStore>
  );
}

/**
 * One store per mount: a decorator re-runs whenever args change, and building
 * the store in its body would wipe whatever the story wrote since. The caller
 * keys it by the display globals, so a toolbar change starts a fresh store.
 */
export function StoryStore({
  globals,
  seeds = [],
  children,
}: {
  globals: StoryGlobals;
  seeds?: AtomSeed[];
  children?: ReactNode;
}) {
  const [store] = useState(() => buildStore([storyDisplaySeed(globals), ...seeds]));
  return <Provider store={store}>{children}</Provider>;
}

/**
 * The seeded store on its own, for stories that need to write to it later (a
 * `play` function driving state, or a render that reads it back).
 */
export function buildStore(seeds: AtomSeed[]): JotaiStore {
  const store = createStore();
  for (const apply of seeds) {
    apply((atom, value) => store.set(atom, value));
  }
  return store;
}
