import { NotePencil, SidebarSimple } from "@phosphor-icons/react";
import { useAtom, useSetAtom } from "jotai";
import { IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { usePhoneViewport } from "@read-aware/ui/media";
import { useTranslation } from "../../../i18n";
import { activeGlobalThreadAtom, newGlobalThreadId } from "../../ai";
import { agentHeaderActionClass } from "../lib/agent-header-action";
import { threadsDrawerOpenAtom, threadsSidebarDockedAtom } from "../state/threads-sidebar";

/**
 * The Agent page's controls at the header's start, above the thread list: the
 * list's toggle (docks or puts it away on a wide screen, pressed while docked;
 * opens the drawer on a phone) and, while the list is out of sight, New
 * conversation beside it — the list carries that action itself when shown.
 */
export function AgentThreadControls() {
  const { t } = useTranslation("ai");
  const isPhone = usePhoneViewport();
  const [docked, setDocked] = useAtom(threadsSidebarDockedAtom);
  const [drawerOpen, setDrawerOpen] = useAtom(threadsDrawerOpenAtom);
  const setActiveThreadId = useSetAtom(activeGlobalThreadAtom);
  const shown = isPhone ? drawerOpen : docked;
  return (
    <span className="flex items-center gap-1.5">
      <Tooltip content={t("agent.threads.title")} side="bottom" align="start">
        <IconButton
          size="sm"
          label={t("agent.threads.title")}
          aria-pressed={shown}
          onClick={() => (isPhone ? setDrawerOpen(!drawerOpen) : setDocked(!docked))}
          className={cn(agentHeaderActionClass, shown && "text-fg")}
          icon={<SidebarSimple size={16} weight={shown ? "fill" : "regular"} aria-hidden="true" />}
        />
      </Tooltip>
      {!shown && (
        <Tooltip content={t("agent.threads.new")} side="bottom" align="start">
          <IconButton
            size="sm"
            label={t("agent.threads.new")}
            onClick={() => setActiveThreadId(newGlobalThreadId())}
            className={agentHeaderActionClass}
            icon={<NotePencil size={16} aria-hidden="true" />}
          />
        </Tooltip>
      )}
    </span>
  );
}
