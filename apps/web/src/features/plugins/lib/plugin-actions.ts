import type { PluginAction } from "./plugin-types";

/** How many actions a view-level toolbar shows inline before folding the rest. */
export const TOOLBAR_INLINE_LIMIT = 2;

/**
 * The most actions a toolbar shows entirely inline when the plugin declared
 * no priorities at all; above this the host applies the inline limit.
 */
export const TOOLBAR_INLINE_ALL_MAX = 3;

export type ToolbarActions = {
  /** Labeled buttons in the row, in declaration order. */
  inline: PluginAction[];
  /** Everything else, in declaration order, behind one "More" menu. */
  overflow: PluginAction[];
};

const isPrimary = (action: PluginAction) =>
  action.priority === "primary" || (action.priority === undefined && action.variant === "solid");

/**
 * Splits a view's actions into the inline row and the overflow menu.
 *
 * Plugins mark `priority` explicitly; the host fills in the rest so a plugin
 * that declares nothing still gets a readable toolbar rather than a row of
 * icon-only buttons:
 * - `primary` (or an unprioritized `solid` action) is always inline.
 * - `secondary` is always in the menu.
 * - With no explicit priorities and at most {@link TOOLBAR_INLINE_ALL_MAX}
 *   actions, everything stays inline.
 * - Otherwise unprioritized actions fill inline slots up to
 *   {@link TOOLBAR_INLINE_LIMIT} (counting primaries) and the rest overflow.
 * - A lone overflow action moves back inline at its declaration position;
 *   the "More" menu never holds a single action.
 */
export function splitToolbarActions(actions: readonly PluginAction[]): ToolbarActions {
  const explicit = actions.some((action) => action.priority !== undefined);
  if (!explicit && actions.length <= TOOLBAR_INLINE_ALL_MAX) {
    return { inline: [...actions], overflow: [] };
  }
  const inline: PluginAction[] = [];
  const overflow: PluginAction[] = [];
  let slots = TOOLBAR_INLINE_LIMIT - actions.filter(isPrimary).length;
  for (const action of actions) {
    if (isPrimary(action)) inline.push(action);
    else if (action.priority === "secondary") overflow.push(action);
    else if (slots > 0) {
      inline.push(action);
      slots -= 1;
    } else overflow.push(action);
  }
  if (overflow.length === 1) return { inline: [...actions], overflow: [] };
  return { inline, overflow };
}
