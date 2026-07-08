/**
 * 全局线程切换器，以 AppHeader 图标弹层呈现（与 AnnotationsPopover 同一
 * 交互与行样式）：头部 eyebrow 标题 + 图标式新建按钮，行内 hover 删除
 * （同 AnnotationRow 的 Trash 模式）。轻量刻意 —— 不占常驻边栏；列表每次
 * 打开时现取，当前未落库的新线程显示占位标题。
 */
import { useEffect, useState } from "react";
import { ChatsCircle, Plus, Trash } from "@phosphor-icons/react";
import { useAtom } from "jotai";
import { Eyebrow, IconButton, Popover } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import {
  clearConversation,
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

  // 删除 = 清空消息 + 会话行留墓碑（列表只列非空会话，所以随即消失）。
  // 弹层保持打开，方便连续清理；删的是当前线程时切到下一个（或全新线程）。
  const remove = async (threadId: string) => {
    await clearConversation(threadId);
    const remaining = threads.filter((thread) => thread.id !== threadId);
    setThreads(remaining);
    if (threadId === activeThreadId) {
      setActiveThreadId(remaining[0]?.id ?? newGlobalThreadId());
    }
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
      <div className="flex shrink-0 items-center justify-between border-b border-border py-1 pl-4 pr-2">
        <Eyebrow as="span">{t("context.threads.title")}</Eyebrow>
        <IconButton
          size="sm"
          label={t("context.threads.new")}
          onClick={() => select(newGlobalThreadId())}
          className="text-fg-muted hover:text-fg"
          icon={<Plus size={14} weight="regular" />}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-0.5 px-2 py-2">
          {activeIsUnsaved && (
            <ThreadRow
              title={t("context.threads.untitled")}
              active
              onSelect={() => select(activeThreadId)}
            />
          )}
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              title={thread.preview?.trim() || t("context.threads.untitled")}
              active={thread.id === activeThreadId}
              onSelect={() => select(thread.id)}
              onDelete={() => void remove(thread.id)}
              deleteLabel={t("context.threads.delete")}
            />
          ))}
        </div>
      </div>
    </Popover>
  );
}

function ThreadRow({
  title,
  active,
  onSelect,
  onDelete,
  deleteLabel,
}: {
  title: string;
  active: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md transition-colors",
        active ? "bg-fill-strong" : "hover:bg-fill",
      )}
    >
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "min-w-0 flex-1 truncate px-2 py-1.5 text-left font-sans text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
          active ? "text-fg" : "text-fg-muted group-hover:text-fg",
        )}
      >
        {title}
      </button>
      {onDelete && (
        <IconButton
          size="sm"
          label={deleteLabel ?? ""}
          onClick={onDelete}
          className="shrink-0 text-fg-subtle opacity-0 hover:text-red-600 group-hover:opacity-100 pointer-coarse:opacity-100"
          icon={<Trash size={12} weight="regular" />}
        />
      )}
    </div>
  );
}
