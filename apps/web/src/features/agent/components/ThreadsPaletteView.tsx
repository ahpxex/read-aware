/**
 * The Agent page's thread switcher, as a palette: a search over the threads'
 * titles and first messages above the list, ↑/↓ to move, Enter to open, Escape to close.
 * Threads are grouped by when each was last active (today, yesterday, the
 * previous 7 and 30 days, then by month), newest first, each with its time;
 * the open one is checked. Deleting is a control at a row's end, shown on
 * hover or while the row is highlighted, and keeps the palette open.
 *
 * Pure presentation: the list's reads, deletes and selection belong to the
 * container (`ThreadsPalette` with `useAgentThreads`), so empty, loading,
 * failed and long-title states render on their own.
 */
import { useMemo, useState } from "react";
import { Check, Trash } from "@phosphor-icons/react";
import { IconButton, InlineError, Palette, PaletteGroup, PaletteOption, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import type { ThreadSummary } from "@read-aware/core";
import { formatDate, useTranslation, type ErrorDescription } from "../../../i18n";
import { groupThreadsByDate, type ThreadGroup } from "../lib/thread-groups";

export type ThreadsPaletteViewProps = {
  open: boolean;
  onClose: () => void;
  threads: ThreadSummary[];
  isLoading: boolean;
  loadFailure: ErrorDescription | null;
  onRetry: () => void;
  activeThreadId: string;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  /** The clock the date groups and times are read against (stories pin it). */
  now?: number;
};

type Row = { id: string; title: string; preview: string; updatedAt: string };

export function ThreadsPaletteView({
  open,
  onClose,
  threads,
  isLoading,
  loadFailure,
  onRetry,
  activeThreadId,
  onSelect,
  onDelete,
  now,
}: ThreadsPaletteViewProps) {
  const { t } = useTranslation(["ai", "command", "common"]);
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLocaleLowerCase();
  const clock = now ?? Date.now();

  const groups = useMemo(() => {
    const untitled = t("agent.threads.untitled");
    const rows: Row[] = threads.map((thread) => ({
      id: thread.id,
      title: thread.title?.trim() || untitled,
      preview: thread.preview ?? "",
      updatedAt: thread.updatedAt ?? "",
    }));
    // A generated title stands for the thread, but the reader may search by
    // their own first words: match either.
    const matching = trimmed
      ? rows.filter(
          (row) => row.title.toLocaleLowerCase().includes(trimmed) || row.preview.toLocaleLowerCase().includes(trimmed),
        )
      : rows;
    return groupThreadsByDate(matching, clock);
  }, [threads, trimmed, clock, t]);
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // The highlight rests on the open thread (or the first) until the arrows or
  // the pointer move it; typing a search moves it to the first match.
  const [highlight, setHighlight] = useState<number | null>(null);
  const openIndex = flat.findIndex((row) => row.id === activeThreadId);
  const current = Math.min(highlight ?? Math.max(0, openIndex), Math.max(0, flat.length - 1));

  const groupLabel = (key: ThreadGroup<Row>["key"]) => {
    if (!key.startsWith("month:")) return t(`agent.threads.groups.${key as Exclude<typeof key, `month:${string}`>}`);
    const [year, month] = key.slice(6).split("-").map(Number);
    return formatDate(new Date(year!, month! - 1, 1), { year: "numeric", month: "long" });
  };
  const timeOf = (key: ThreadGroup<Row>["key"], updatedAt: string) => {
    const time = Date.parse(updatedAt);
    if (Number.isNaN(time)) return "";
    return key === "today" || key === "yesterday"
      ? formatDate(new Date(time), { hour: "numeric", minute: "2-digit" })
      : formatDate(new Date(time), { month: "short", day: "numeric" });
  };

  let index = -1;
  return (
    <Palette
      open={open}
      onClose={onClose}
      searchLabel={t("agent.threads.search")}
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        setHighlight(0);
      }}
      selectedIndex={current}
      onMove={(direction) => {
        if (flat.length > 0) setHighlight((current + direction + flat.length) % flat.length);
      }}
      onRun={() => {
        const row = flat[current];
        if (row) onSelect(row.id);
      }}
      footer={
        <>
          <span>{t("command:results", { count: flat.length })}</span>
          <div className="flex gap-3">
            <span>{t("command:footer.navigate")}</span>
            <span>{t("agent.threads.footerOpen")}</span>
            <span>{t("command:footer.close")}</span>
          </div>
        </>
      }
    >
      {isLoading && threads.length === 0 ? (
        <div className="flex justify-center py-12">
          <Spinner size="sm" />
        </div>
      ) : loadFailure ? (
        <div className="px-4 py-6">
          <InlineError
            onRetry={loadFailure.retryable ? onRetry : undefined}
            retryLabel={t("common:errorBoundary.retry")}
          >
            {loadFailure.body}
          </InlineError>
        </div>
      ) : flat.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-fg-muted">
          {trimmed ? t("agent.threads.noMatches", { query: query.trim() }) : t("agent.threads.empty")}
        </div>
      ) : (
        groups.map((group) => (
          <PaletteGroup key={group.key} label={groupLabel(group.key)}>
            {group.items.map((row) => {
              index += 1;
              const rowIndex = index;
              const isOpen = row.id === activeThreadId;
              return (
                <PaletteOption
                  key={row.id}
                  index={rowIndex}
                  selected={rowIndex === current}
                  aria-current={isOpen ? "true" : undefined}
                  title={row.title}
                  onHover={() => setHighlight(rowIndex)}
                  onRun={() => onSelect(row.id)}
                  actions={
                    <IconButton
                      size="sm"
                      label={t("agent.threads.delete")}
                      onClick={() => onDelete(row.id)}
                      className="text-fg-subtle hover:text-red-600"
                      icon={<Trash size={14} aria-hidden="true" />}
                    />
                  }
                >
                  <span className={cn("min-w-0 flex-1 truncate text-sm text-fg", isOpen && "font-medium")}>
                    {row.title}
                  </span>
                  {isOpen && <Check size={14} aria-hidden="true" className="shrink-0 text-fg-muted" />}
                  <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
                    {timeOf(group.key, row.updatedAt)}
                  </span>
                </PaletteOption>
              );
            })}
          </PaletteGroup>
        ))
      )}
    </Palette>
  );
}
