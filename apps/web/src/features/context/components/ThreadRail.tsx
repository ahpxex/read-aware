import { Plus } from "@phosphor-icons/react";
import { Eyebrow, IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import type { GlobalThreads } from "../../ai/hooks/useGlobalThreads";

/**
 * Context 页左侧的线程列（编辑风格：一列安静的标题，无边框卡片）。
 * 标题即首条用户消息；当前未落库的新线程显示为"未命名"占位。
 * 窄屏（阅读面板宽度以下）隐藏 —— 移动端 v1 只保留当前线程。
 */
export function ThreadRail({ threads }: { threads: GlobalThreads }) {
  const { t } = useTranslation("ai");
  const activeIsUnsaved = !threads.threads.some((thread) => thread.id === threads.activeThreadId);

  return (
    <nav
      aria-label={t("context.threads.title")}
      className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border px-3 py-4 md:flex"
    >
      <div className="mb-2 flex items-center justify-between pl-2">
        <Eyebrow className="uppercase tracking-wide text-fg-subtle">
          {t("context.threads.title")}
        </Eyebrow>
        <IconButton
          icon={<Plus size={14} />}
          label={t("context.threads.new")}
          size="sm"
          onClick={threads.create}
        />
      </div>
      {activeIsUnsaved && (
        <ThreadItem
          title={t("context.threads.untitled")}
          active
          onClick={() => threads.select(threads.activeThreadId)}
        />
      )}
      {threads.threads.map((thread) => (
        <ThreadItem
          key={thread.id}
          title={thread.preview?.trim() || t("context.threads.untitled")}
          active={thread.id === threads.activeThreadId}
          onClick={() => threads.select(thread.id)}
        />
      ))}
    </nav>
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
