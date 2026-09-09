/**
 * Full-page container for a shelf header action registered with
 * `presentation: "page"` — the plugin analogue of the Stats surface: it
 * occupies the top-nav state (`plugin:<key>`), gets the header's back
 * affordance, and renders its view vocabulary in a centered column. If the
 * plugin vanishes (disabled/uninstalled) the page exits to the shelf.
 */
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { Caption, Heading, Stack } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { showPluginFailureToast } from "../lib/plugin-toast";
import { headerActionsAtom } from "../state/plugin-store";
import { PluginViewRenderer } from "./PluginViewRenderer";
import { contributionText } from "../lib/plugin-i18n";
import { usePluginViewSource } from "../hooks/usePluginViewSource";
import { actionVisible } from "../lib/plugin-action-state";

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
  const action = actions.find((entry) => entry.key === key && entry.surface === "shelf" && actionVisible(entry)) ?? null;
  const [viewDepth, setViewDepth] = useState(0);
  const { view, refresh: refreshView } = usePluginViewSource(action?.view, action !== null,
    () => action!.view({}),
    () => { showPluginFailureToast(action?.pluginName); onExit(); },
  );

  useEffect(() => {
    if (!action) onExit();
  }, [action, onExit]);

  if (!action) return null;
  const title = contributionText(action.title);

  return (
    <Stack
      gap="none"
      // A page scrolls as a page: content flows in the app scroll viewport
      // (title included), so the scrollbar lives at the window edge like on
      // every other full-page surface. Windowed lists virtualize against
      // that same viewport (PluginVirtualRows).
      className="mx-auto w-full max-w-5xl px-6 py-8 pb-[calc(2rem+var(--ra-safe-bottom))]"
    >
      {viewDepth <= 1 && (
        <Stack gap="xs" className={cn("shrink-0", action.pluginName === title ? "mb-4" : "mb-6")}>
          <Heading as="h1">{title}</Heading>
          {action.pluginName !== title && (
            <Caption className="text-fg-subtle">{action.pluginName}</Caption>
          )}
        </Stack>
      )}
      <PluginViewRenderer
        view={view}
        onClose={onExit}
        onDepthChange={setViewDepth}
        onRequestRefresh={refreshView}
        viewStateKey={action.key}
        scroll="flow"
      />
    </Stack>
  );
}
