import { Notebook, Plus, SidebarSimple } from "@phosphor-icons/react";
import { useAtom } from "jotai";
import { IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { usePhoneViewport } from "@read-aware/ui/media";
import { useTranslation } from "../../../i18n";
import type { HeaderActionEntry } from "../../navigation/lib/header-actions";
import { agentHeaderActionClass } from "../lib/agent-header-action";
import { threadsDrawerOpenAtom, threadsSidebarDockedAtom } from "../state/threads-sidebar";
import { usePluginAgentHeaderEntries } from "../../plugins/hooks/usePluginAgentHeaderEntries";

/**
 * The Agent page's header actions, atomized (see HeaderActionEntry): new
 * conversation, the thread list's toggle (docked at the page's left edge, a
 * drawer on a phone), and the highlights & notes page. Each can collapse
 * independently into the dots menu on narrow windows.
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
  const isPhone = usePhoneViewport();
  const [docked, setDocked] = useAtom(threadsSidebarDockedAtom);
  const [drawerOpen, setDrawerOpen] = useAtom(threadsDrawerOpenAtom);
  const threadsShown = isPhone ? drawerOpen : docked;
  const toggleThreads = () => (isPhone ? setDrawerOpen(!drawerOpen) : setDocked(!docked));

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
      id: "context:threads",
      inline: (
        <Tooltip content={t("agent.threads.title")} side="bottom">
          <IconButton
            size="sm"
            label={t("agent.threads.title")}
            aria-pressed={threadsShown}
            onClick={toggleThreads}
            className={cn(agentHeaderActionClass, threadsShown && "text-fg")}
            icon={<SidebarSimple size={16} weight={threadsShown ? "fill" : "regular"} aria-hidden="true" />}
          />
        </Tooltip>
      ),
      overflow: {
        id: "context:threads",
        label: t("agent.threads.title"),
        icon: <SidebarSimple size={16} weight="regular" aria-hidden="true" />,
        run: toggleThreads,
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
