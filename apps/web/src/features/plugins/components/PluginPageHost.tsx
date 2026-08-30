/**
 * Full-page container for a shelf header action registered with
 * `presentation: "page"` — the plugin analogue of the Stats surface: it
 * occupies the top-nav state (`plugin:<key>`), gets the header's back
 * affordance, and renders its view vocabulary in a centered column. If the
 * plugin vanishes (disabled/uninstalled) the page exits to the shelf.
 */
import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { Caption, Heading, Stack } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { showPluginFailureToast } from "../lib/plugin-toast";
import type { PluginView } from "../lib/plugin-types";
import { headerActionsAtom } from "../state/plugin-store";
import { PluginViewRenderer } from "./PluginViewRenderer";
import { contributionText } from "../lib/plugin-i18n";
import { createLogger } from "../../../platform/logger";

const log = createLogger("plugins");

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
  const [viewDepth, setViewDepth] = useState(0);
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    if (!action) {
      onExit();
      return;
    }
    const requestId = ++loadRequestIdRef.current;
    setView(null);
    setViewDepth(0);
    Promise.resolve(action.view({}))
      .then((next) => {
        if (loadRequestIdRef.current === requestId) setView(next);
      })
      .catch((error) => {
        log.error(`page "${key}" failed`, error);
        showPluginFailureToast(action.pluginName);
        if (loadRequestIdRef.current === requestId) onExit();
      });
    return () => {
      if (loadRequestIdRef.current === requestId) loadRequestIdRef.current += 1;
    };
    // Refetch only when the target action changes, not on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.key]);

  const refreshView = () => {
    if (!action) return;
    const requestId = ++loadRequestIdRef.current;
    Promise.resolve(action.view({}))
      .then((next) => {
        if (loadRequestIdRef.current === requestId) setView(next);
      })
      .catch((error) => {
        log.error(`page "${key}" refresh failed`, error);
        showPluginFailureToast(action.pluginName);
      });
  };

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
