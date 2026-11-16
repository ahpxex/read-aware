import { ChatsCircle, NotePencil } from "@phosphor-icons/react";
import { useSetAtom } from "jotai";
import { IconButton, Tooltip } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { HeaderActionEntry } from "../../navigation";
import { agentHeaderActionClass } from "../lib/agent-header-action";
import { threadsPaletteOpenAtom } from "../state/threads-palette";

/**
 * The Agent page's own header actions, atomized (see HeaderActionEntry): New
 * conversation and Threads, which opens the thread palette. Each can collapse
 * independently into the dots menu on narrow windows. Plugin actions follow
 * them (the app shell appends those).
 */
export function useAgentHeaderActions({ onNewConversation }: { onNewConversation: () => void }): HeaderActionEntry[] {
  const { t } = useTranslation("ai");
  const openThreads = useSetAtom(threadsPaletteOpenAtom);
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
            icon={<NotePencil size={16} aria-hidden="true" />}
          />
        </Tooltip>
      ),
      overflow: {
        id: "context:new-conversation",
        label: t("agent.threads.new"),
        icon: <NotePencil size={16} aria-hidden="true" />,
        run: onNewConversation,
      },
    },
    {
      id: "context:threads",
      inline: (
        <Tooltip content={t("agent.threads.title")} side="bottom" align="end">
          <IconButton
            size="sm"
            label={t("agent.threads.title")}
            onClick={() => openThreads(true)}
            className={agentHeaderActionClass}
            icon={<ChatsCircle size={16} aria-hidden="true" />}
          />
        </Tooltip>
      ),
      overflow: {
        id: "context:threads",
        label: t("agent.threads.title"),
        icon: <ChatsCircle size={16} aria-hidden="true" />,
        run: () => openThreads(true),
      },
    },
  ];
}
