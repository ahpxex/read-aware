/**
 * Which discovered tools the model currently holds schemas for.
 *
 * The runtime can only execute what a request declares, so unloading a tool the
 * model is working with turns its next call into "tool not found". The loadout
 * therefore orders tools by when they were last needed (loaded or called), never
 * unloads one called during the current reply, and reports every unload so the
 * model can ask for the tool again by name.
 */
export interface ToolLoadout {
  /** Loaded tool names, least recently needed first. */
  readonly loaded: Set<string>;
  /** Tools called since the current reply began; these stay loaded until it ends. */
  readonly usedThisTurn: Set<string>;
}

/**
 * Schemas kept beyond the core set between replies. A reply that calls more
 * discovered tools than this keeps them all until it ends, then trims.
 */
export const MAX_LOADED_TOOLS = 12;

export function createToolLoadout(): ToolLoadout {
  return { loaded: new Set(), usedThisTurn: new Set() };
}

/** Unload the least recently needed tools above the budget, sparing the ones in use. */
function trim(loadout: ToolLoadout, keep: ReadonlySet<string>): string[] {
  const unloaded: string[] = [];
  for (const name of loadout.loaded) {
    if (loadout.loaded.size <= MAX_LOADED_TOOLS) break;
    if (keep.has(name) || loadout.usedThisTurn.has(name)) continue;
    loadout.loaded.delete(name);
    unloaded.push(name);
  }
  return unloaded;
}

/**
 * Load `names` as the most recently needed tools. The tools just requested are
 * never the ones unloaded to make room for themselves.
 */
export function loadTools(loadout: ToolLoadout, names: readonly string[]): { loaded: string[]; unloaded: string[] } {
  for (const name of names) {
    loadout.loaded.delete(name);
    loadout.loaded.add(name);
  }
  const unloaded = trim(loadout, new Set(names));
  return { loaded: [...loadout.loaded], unloaded };
}

/** A call marks the tool as in use for this reply and as the most recently needed. */
export function noteToolUse(loadout: ToolLoadout, name: string): void {
  if (!loadout.loaded.has(name)) return;
  loadout.loaded.delete(name);
  loadout.loaded.add(name);
  loadout.usedThisTurn.add(name);
}

/** A new reply begins: nothing is in use yet, and the budget applies again. */
export function beginLoadoutTurn(loadout: ToolLoadout): void {
  loadout.usedThisTurn.clear();
  trim(loadout, new Set());
}

/** The thread's agent was discarded: the next one starts from the core set. */
export function resetToolLoadout(loadout: ToolLoadout): void {
  loadout.loaded.clear();
  loadout.usedThisTurn.clear();
}
