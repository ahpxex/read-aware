import { CONTEXT_BUNDLE_KINDS, type ContextBundle, type ContextBundleKind, type ContextBundleScope, type ContextBundleSelector } from "@read-aware/core";

export type ContextBundleScopeChoice =
  | { value: "user"; kind: "user" }
  | { value: `book:${string}`; kind: "book"; id: string; title: string }
  | { value: `conversation:${string}`; kind: "conversation"; id: string; title: string | undefined };

/** The scope kinds each recipe accepts, in the order the settings picker offers them. */
export const CONTEXT_BUNDLE_SCOPE_KINDS: Record<ContextBundleKind, ContextBundleScope["kind"][]> = {
  user_profile_context: ["user"],
  reading_intent_context: ["user", "book"],
  book_memory_context: ["book"],
  conversation_insights_context: ["book", "conversation"],
};
export const CONTEXT_BUNDLE_RECIPES: readonly ContextBundleKind[] = CONTEXT_BUNDLE_KINDS;

/** Every scope the host can currently offer for a recipe; empty means the recipe has no target yet. */
export function contextBundleScopeChoices(recipe: ContextBundleKind, books: readonly { id: string; title: string }[],
  threads: readonly { id: string; title?: string }[]): ContextBundleScopeChoice[] {
  const choices: ContextBundleScopeChoice[] = [];
  for (const kind of CONTEXT_BUNDLE_SCOPE_KINDS[recipe]) {
    if (kind === "user") choices.push({ value: "user", kind });
    if (kind === "book") for (const book of books) choices.push({ value: `book:${book.id}`, kind, id: book.id, title: book.title });
    if (kind === "conversation") for (const thread of threads) choices.push({ value: `conversation:${thread.id}`, kind, id: thread.id, title: thread.title });
  }
  return choices;
}

/** A selector only for a choice the recipe actually accepts; stale choices from another recipe yield null. */
export function contextBundleSelectorFor(recipe: ContextBundleKind, choice: string, choices: readonly ContextBundleScopeChoice[]): ContextBundleSelector | null {
  const match = choices.find(candidate => candidate.value === choice);
  if (!match) return null;
  return { kind: recipe, scope: match.kind === "user" ? { kind: "user" } : { kind: match.kind, id: match.id } };
}

export function defaultContextBundleScope(choices: readonly ContextBundleScopeChoice[], current: string): string {
  return choices.some(choice => choice.value === current) ? current : choices[0]?.value ?? "";
}

export function summarizeContextBundle(bundle: ContextBundle): { version: string; items: number; omitted: number } {
  return { version: shortContextBundleVersion(bundle.version), items: bundle.content.items.length,
    omitted: bundle.content.omissions.reduce((count, omission) => count + omission.count, 0) };
}

export function shortContextBundleVersion(version: string): string {
  return version.startsWith("cb1:") ? version.slice(4, 16) : version;
}
