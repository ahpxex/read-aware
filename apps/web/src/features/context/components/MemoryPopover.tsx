/**
 * Memory as a lightweight header popover (not a permanent sidebar). The trigger
 * is a quiet Brain icon; the panel drops down with a compact, flat list of
 * memory records. Replaces the old MemoryPanel sidebar section.
 */
import { useCallback, useEffect, useState } from "react";
import { Brain, X } from "@phosphor-icons/react";
import type { MemoryRecord } from "@read-aware/agent";
import { Caption, Eyebrow, IconButton, Popover, Tag } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { createMemoryPort } from "../../ai/agent/ports/memory-port";
import { listAllMemoryRows } from "../../ai/agent/ports/memory-store";

const triggerClass =
  "items-center text-fg-muted hover:text-fg h-7 w-7 justify-center";

export function MemoryPopover() {
  const { t } = useTranslation("ai");
  const [memories, setMemories] = useState<MemoryRecord[]>([]);

  const load = useCallback(async () => {
    const rows = await listAllMemoryRows();
    setMemories(
      rows
        .filter((memory) => (memory.status ?? "active") === "active")
        .sort(
          (a, b) => b.importance - a.importance || b.updatedAt.localeCompare(a.updatedAt),
        ),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const forget = useCallback(
    async (id: string) => {
      await createMemoryPort().applyMemoryChanges([{ type: "forget", id }]);
      void load();
    },
    [load],
  );

  return (
    <Popover
      trigger={
        <>
          <Brain size={16} weight="regular" aria-hidden="true" />
          {memories.length > 0 && (
            <Caption className="ml-0.5 text-fg-subtle tabular-nums">
              {memories.length}
            </Caption>
          )}
        </>
      }
      triggerLabel={t("context.memory.title")}
      triggerTooltip={t("context.memory.title")}
      triggerClassName={triggerClass}
      align="right"
      panelClassName="flex w-80 max-h-96 flex-col overflow-y-auto p-3"
    >
      <Eyebrow className="mb-2 text-fg-muted">
        {t("context.memory.title")} · {memories.length}
      </Eyebrow>
      {memories.length === 0 && (
        <Caption className="text-fg-subtle">{t("context.memory.empty")}</Caption>
      )}
      <div className="flex flex-col gap-1.5">
        {memories.map((memory) => (
          <div
            key={memory.id}
            className="group flex gap-2 rounded-md px-2 py-1.5 hover:bg-fg/5"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-relaxed text-fg">{memory.content}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <Tag>{memory.scope}</Tag>
                <Tag>{memory.kind}</Tag>
                <Caption className="ml-auto text-fg-subtle tabular-nums">
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
    </Popover>
  );
}
