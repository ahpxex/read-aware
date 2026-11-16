import { Notebook, Plus } from "@phosphor-icons/react";
import { IconButton, Tooltip } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { HeaderActionEntry } from "../../navigation/lib/header-actions";
import { agentHeaderActionClass } from "../lib/agent-header-action";
import { usePluginAgentHeaderEntries } from "../../plugins/hooks/usePluginAgentHeaderEntries";

/**
 * The Agent page's header actions, atomized (see HeaderActionEntry): new
 * conversation and the highlights & notes page. Each can collapse
 * independently into the dots menu on narrow windows. The thread list's
 * toggle is not among them: it sits at the header's start, above the list
 * (`ThreadsSidebarToggle`).
 */
export function useAgentHeaderActions({
  onOpenAnnotations,
  onNewConversation,
}: {
  onOpenAnnotations: () => void;
  onNewConversation: () => void;
}): HeaderActionEntry[] {
  const { t } = useTranslation("ai");
  const pluginEntries = usePluginAgentHeaderEntries();

  return [
    {
      id: "context:new-conversation",
      inline: (
        <Tooltip content={t("agent.threads.new")} side="bottom">
          <IconButton
            size="sm"
            label={t("agent.threads.new")}
            onClick={onNewConversation}
            className={agentHeaderActionClass}
            icon={<Plus size={16} weight="regular" aria-hidden="true" />}
          />
        </Tooltip>
      ),
      overflow: {
        id: "context:new-conversation",
        label: t("agent.threads.new"),
        icon: <Plus size={16} weight="regular" aria-hidden="true" />,
        run: onNewConversation,
      },
    },
    {
      id: "context:annotations",
      inline: (
        <Tooltip content={t("agent.annotations.title")} side="bottom" align="end">
          <IconButton
            size="sm"
            label={t("agent.annotations.title")}
            onClick={onOpenAnnotations}
            className={agentHeaderActionClass}
            icon={<Notebook size={16} weight="regular" aria-hidden="true" />}
          />
        </Tooltip>
      ),
      overflow: {
        id: "context:annotations",
        label: t("agent.annotations.title"),
        icon: <Notebook size={16} weight="regular" aria-hidden="true" />,
        run: onOpenAnnotations,
      },
    },
    ...pluginEntries,
  ];
}
