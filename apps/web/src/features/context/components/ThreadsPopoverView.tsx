/**
 * 全局线程切换器，以 AppHeader 图标弹层呈现（与 AnnotationsPopover 同一
 * 交互与行样式）：头部只标明历史会话，行内 hover 删除（同 AnnotationRow
 * 的 Trash 模式）。新建会话是相邻的独立 header action，不藏在弹层里。
 * 列表每次打开时现取，当前未落库的新线程显示占位标题。
 *
 * 纯表现层：线程列表的读取与删除由容器（`ThreadsPopover`）持有，
 * 因此空列表、未落库新线程、长标题等状态都能单独渲染。
 */
import { ChatsCircle, Trash } from "@phosphor-icons/react";
import { Eyebrow, IconButton, Popover } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import type { ConversationSummary } from "../../ai/lib/conversation-store";
import { contextHeaderActionClass } from "../lib/context-header-action";

type ThreadsPopoverViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threads: ConversationSummary[];
  activeThreadId: string;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string) => void;
};

export function ThreadsPopoverView({
  open,
  onOpenChange,
  threads,
  activeThreadId,
  onSelect,
  onDelete,
}: ThreadsPopoverViewProps) {
  const { t } = useTranslation("ai");

  const select = (threadId: string) => {
    onSelect(threadId);
    onOpenChange(false);
  };

  const activeIsUnsaved = !threads.some(
    (thread) => thread.id === activeThreadId,
  );

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      align="right"
      triggerLabel={t("context.threads.title")}
      triggerTooltip={t("context.threads.title")}
      triggerTooltipAlign="end"
      triggerClassName={cn(contextHeaderActionClass, open && "text-fg")}
      trigger={
        <ChatsCircle
          size={16}
          weight={open ? "fill" : "regular"}
          aria-hidden="true"
        />
      }
      panelClassName="flex max-h-[min(24rem,60vh)] w-[clamp(16rem,24vw,22rem)] flex-col overflow-hidden p-0"
    >
      <div className="flex shrink-0 items-center border-b border-border px-4 py-2.5">
        <Eyebrow as="span">{t("context.threads.title")}</Eyebrow>
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
              onDelete={() => onDelete(thread.id)}
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
