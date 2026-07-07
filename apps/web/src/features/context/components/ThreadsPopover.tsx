/**
 * 全局线程切换器，以 AppHeader 图标弹层呈现（与 AnnotationsPopover 同一
 * 交互与行样式）：新建线程 + 线程列表（标题 = 首条用户消息）。轻量刻意 ——
 * 不占常驻边栏；列表每次打开时现取，当前未落库的新线程显示占位标题。
 */
import { useEffect, useState } from "react";
import { ChatsCircle, Plus } from "@phosphor-icons/react";
import { useAtom } from "jotai";
import { Eyebrow, Popover } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import {
  listGlobalThreads,
  newGlobalThreadId,
  type ConversationSummary,
} from "../../ai/lib/conversation-store";
import { activeGlobalThreadAtom } from "../../ai/state/global-thread";

// Mirrors the AppHeader icon buttons so the trigger sits flush with them.
const TRIGGER_CLASS =
  "relative h-7 w-7 items-center justify-center text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg before:absolute before:-inset-1 before:content-['']";

export function ThreadsPopover() {
  const { t } = useTranslation("ai");
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ConversationSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useAtom(activeGlobalThreadAtom);

  // Reload on every open — threads accrue and retitle as turns commit.
  useEffect(() => {
    if (open) void listGlobalThreads().then(setThreads);
  }, [open]);

  const select = (threadId: string) => {
    setActiveThreadId(threadId);
    setOpen(false);
  };

  const activeIsUnsaved = !threads.some((thread) => thread.id === activeThreadId);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="right"
      triggerLabel={t("context.threads.title")}
      triggerTooltip={t("context.threads.title")}
      triggerTooltipAlign="end"
      triggerClassName={cn(TRIGGER_CLASS, open && "text-fg")}
      trigger={<ChatsCircle size={16} weight={open ? "fill" : "regular"} aria-hidden="true" />}
      panelClassName="flex max-h-[min(24rem,60vh)] w-[clamp(16rem,24vw,22rem)] flex-col overflow-hidden p-0"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <Eyebrow as="span">{t("context.threads.title")}</Eyebrow>
        <button
          type="button"
          onClick={() => select(newGlobalThreadId())}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-fg-muted transition-colors hover:bg-fill hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
        >
          <Plus size={12} aria-hidden="true" />
          {t("context.threads.new")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-0.5 px-2 py-2">
          {activeIsUnsaved && (
            <ThreadItem
              title={t("context.threads.untitled")}
              active
              onClick={() => select(activeThreadId)}
            />
          )}
          {threads.map((thread) => (
            <ThreadItem
              key={thread.id}
              title={thread.preview?.trim() || t("context.threads.untitled")}
              active={thread.id === activeThreadId}
              onClick={() => select(thread.id)}
            />
          ))}
        </div>
      </div>
    </Popover>
  );
}

function ThreadItem({
  title,
  active,
  onClick,
}: {
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "w-full truncate rounded-md px-2 py-1.5 text-left font-sans text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
        active ? "bg-fill-strong text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
      )}
    >
      {title}
    </button>
  );
}
