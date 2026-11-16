import { SidebarSimple } from "@phosphor-icons/react";
import { useAtom } from "jotai";
import { IconButton, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { usePhoneViewport } from "@read-aware/ui/media";
import { useTranslation } from "../../../i18n";
import { agentHeaderActionClass } from "../lib/agent-header-action";
import { threadsDrawerOpenAtom, threadsSidebarDockedAtom } from "../state/threads-sidebar";

/**
 * The Agent page's thread-list toggle, at the header's start above the list
 * it shows: it docks or puts away the list on a wide screen (pressed while
 * docked) and opens the drawer on a phone.
 */
export function ThreadsSidebarToggle() {
  const { t } = useTranslation("ai");
  const isPhone = usePhoneViewport();
  const [docked, setDocked] = useAtom(threadsSidebarDockedAtom);
  const [drawerOpen, setDrawerOpen] = useAtom(threadsDrawerOpenAtom);
  const shown = isPhone ? drawerOpen : docked;
  return (
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
  );
}
