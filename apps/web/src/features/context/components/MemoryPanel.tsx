/**
 * 记忆透明面板（doc §9）：查看 agent 的长期记忆、手动遗忘。
 * 既是信任功能，也是"显式用户反馈"检索信号的入口（遗忘即反馈）。
 */
import { useCallback, useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import type { MemoryRecord } from "@read-aware/agent";
import { Body, Caption, Eyebrow, IconButton, Tag } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { createMemoryPort } from "../../ai/agent/ports/memory-port";
import { listAllMemoryRows } from "../../ai/agent/ports/memory-store";

export function MemoryPanel() {
  const { t } = useTranslation("ai");
  const [memories, setMemories] = useState<MemoryRecord[]>([]);

  const load = useCallback(async () => {
    const rows = await listAllMemoryRows();
    setMemories(
      rows
        .filter((memory) => (memory.status ?? "active") === "active")
        .sort((a, b) => b.importance - a.importance || b.updatedAt.localeCompare(a.updatedAt)),
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
    <section className="border-b border-border px-4 py-4">
      <Eyebrow className="mb-3 text-fg-muted">
        {t("context.memory.title")} · {memories.length}
      </Eyebrow>
      <div className="flex flex-col gap-2">
        {memories.length === 0 && (
          <Caption className="text-fg-subtle">{t("context.memory.empty")}</Caption>
        )}
        {memories.map((memory) => (
          <div key={memory.id} className="group flex gap-2 rounded-md bg-surface p-2.5 shadow-sm">
            <div className="min-w-0 flex-1">
              <Body className="text-sm leading-relaxed">{memory.content}</Body>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Tag>{memory.scope}</Tag>
                <Tag>{memory.kind}</Tag>
                <Caption className="ml-auto text-fg-subtle">
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
    </section>
  );
}
