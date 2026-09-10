import { useAtomValue } from "jotai";
import { activeGlobalThreadAtom } from "../../ai/state/global-thread";
import type { HeaderActionEntry } from "../../navigation/lib/header-actions";
import { PluginHeaderItem } from "../components/PluginHeaderCluster";
import { headerActionsAtom } from "../state/plugin-store";
import { actionEnabled, actionVisible } from "../lib/plugin-action-state";
import { contributionText } from "../lib/plugin-i18n";
import { renderPluginIcon } from "../lib/plugin-icons";
import { openHeaderActionDialog } from "../lib/open-header-action";
import type { HeaderActionInput } from "../lib/plugin-types";

export function usePluginAgentHeaderEntries(): HeaderActionEntry[] {
  const actions = useAtomValue(headerActionsAtom);
  const threadId = useAtomValue(activeGlobalThreadAtom);
  const input: HeaderActionInput = { thread: { kind: "global", id: threadId } };
  return actions.filter(action => action.surface === "agent" && actionVisible(action)).map(action => ({
    id: `plugin:${action.key}`,
    inline: <PluginHeaderItem key={`${action.key}:${threadId}`} action={action} input={input} />,
    overflow: {
      id: `plugin:${action.key}`,
      label: contributionText(action.title),
      icon: renderPluginIcon(action.icon, 16),
      disabled: !actionEnabled(action),
      checked: action.state?.checked,
      run: () => { void openHeaderActionDialog(action, input); },
    },
  }));
}
