/**
 * Full-page container for a shelf header action registered with
 * `presentation: "page"` — the plugin analogue of the Stats surface: it
 * occupies the top-nav state (`plugin:<key>`), gets the header's back
 * affordance, and renders its view vocabulary in a centered column. If the
 * plugin vanishes (disabled/uninstalled) the page exits to the shelf.
 */
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { Caption, Heading } from "@read-aware/ui";
import { showPluginToast } from "../lib/plugin-toast";
import type { PluginView } from "../lib/plugin-types";
import { headerActionsAtom } from "../state/plugin-store";
import { PluginViewRenderer } from "./PluginViewRenderer";

export const PLUGIN_NAV_PREFIX = "plugin:";

type PluginPageHostProps = {
  /** The active top-nav value, e.g. `plugin:<pluginId>:<actionId>`. */
  navKey: string;
  onExit: () => void;
};

export function PluginPageHost({ navKey, onExit }: PluginPageHostProps) {
  const key = navKey.startsWith(PLUGIN_NAV_PREFIX)
    ? navKey.slice(PLUGIN_NAV_PREFIX.length)
    : navKey;
  const actions = useAtomValue(headerActionsAtom);
  const action = actions.find((entry) => entry.key === key && entry.surface === "shelf") ?? null;
  const [view, setView] = useState<PluginView | null>(null);

  useEffect(() => {
    if (!action) {
      onExit();
      return;
    }
    let cancelled = false;
    setView(null);
    Promise.resolve(action.view({}))
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch((error) => {
        console.error(`[plugins] page "${key}" failed`, error);
        showPluginToast(
          `${action.pluginName}: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (!cancelled) onExit();
      });
    return () => {
      cancelled = true;
    };
    // Refetch only when the target action changes, not on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.key]);

  if (!action) return null;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 pb-[calc(2rem+var(--ra-safe-bottom))]">
      <div className="mb-6 flex flex-col gap-1">
        <Heading as="h1">{action.title}</Heading>
        <Caption className="text-fg-subtle">{action.pluginName}</Caption>
      </div>
      <PluginViewRenderer view={view} onClose={onExit} />
    </div>
  );
}
