/**
 * 记忆透明面板（docs/agent-architecture.md §9），以 AppHeader 图标弹层呈现
 * （与 reader 顶栏的 ReaderNotesPopover 同一交互）：查看 agent 的长期记忆、
 * 手动遗忘。既是信任功能，也是"显式用户反馈"检索信号的入口（遗忘即反馈）。
 */
import { useCallback, useEffect, useState } from "react";
import { Brain, X } from "@phosphor-icons/react";
import type { MemoryRecord } from "@read-aware/agent";
import { Body, Caption, Eyebrow, IconButton, Popover, Tag } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatNumber, useTranslation } from "../../../i18n";
import { createMemoryPort } from "../../ai/agent/ports/memory-port";
import { listAllMemoryRows } from "../../ai/agent/ports/memory-store";

// Mirrors the AppHeader icon buttons so the trigger sits flush with them.
const TRIGGER_CLASS =
  "relative h-7 w-7 items-center justify-center text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg before:absolute before:-inset-1 before:content-['']";

export function MemoryPopover() {
  const { t } = useTranslation("ai");
  const [open, setOpen] = useState(false);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);

  const load = useCallback(async () => {
    const rows = await listAllMemoryRows();
    setMemories(
      rows
        .filter((memory) => (memory.status ?? "active") === "active")
        .sort((a, b) => b.importance - a.importance || b.updatedAt.localeCompare(a.updatedAt)),
    );
  }, []);

  // Reload on every open — the agent keeps writing memory while the user chats.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const forget = useCallback(
    async (id: string) => {
      await createMemoryPort().applyMemoryChanges([{ type: "forget", id }]);
      void load();
    },
    [load],
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="right"
      triggerLabel={t("context.memory.title")}
      triggerTooltip={t("context.memory.title")}
      triggerTooltipAlign="end"
      triggerClassName={cn(TRIGGER_CLASS, open && "text-fg")}
      trigger={<Brain size={16} weight={open ? "fill" : "regular"} aria-hidden="true" />}
      panelClassName="flex max-h-[min(28rem,70vh)] w-[clamp(18rem,28vw,26rem)] flex-col overflow-hidden p-0"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <Eyebrow as="span">{t("context.memory.title")}</Eyebrow>
        <span className="text-xs tabular-nums text-fg-subtle">
          {formatNumber(memories.length)}
        </span>
      </div>

      {memories.length === 0 ? (
        <div className="px-4 py-8">
          <Body className="text-center text-sm text-fg-muted">
            {t("context.memory.empty")}
          </Body>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-1.5 px-3 py-3">
            {memories.map((memory) => (
              <div
                key={memory.id}
                className="group flex gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-fg/5"
              >
                <div className="min-w-0 flex-1">
                  <Body className="text-sm leading-relaxed">{memory.content}</Body>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Tag>{memory.scope}</Tag>
                    <Tag>{memory.kind}</Tag>
                    <Caption className="ml-auto tabular-nums text-fg-subtle">
                      {memory.importance.toFixed(2)} · ×{memory.evidenceCount}
                    </Caption>
                  </div>
                </div>
                <IconButton
                  label={t("context.memory.forget")}
                  size="sm"
                  onClick={() => void forget(memory.id)}
                  className="shrink-0 opacity-0 group-hover:opacity-100"
                  icon={<X size={12} weight="regular" />}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}
