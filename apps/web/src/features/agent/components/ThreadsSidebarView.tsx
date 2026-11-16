/**
 * The Agent page's thread list: every stored global conversation, grouped by
 * when it was last active, newest first, under one row holding a search over
 * their titles and New conversation. The open thread is marked; deleting is a
 * hover control at a row's end (always shown on touch). A new conversation
 * joins the list with its first turn, so until then nothing is marked.
 *
 * Pure presentation: the list's reads, deletes and selection belong to the
 * container (`useAgentThreads`), so empty, loading, failed and long-title
 * states render on their own.
 */
import { useMemo, useState } from "react";
import { NotePencil, Trash } from "@phosphor-icons/react";
import { Body, IconButton, InlineError, ScrollArea, SearchField, Spinner, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import type { ThreadSummary } from "@read-aware/core";
import { formatDate, useTranslation, type ErrorDescription } from "../../../i18n";
import { groupThreadsByDate, type ThreadGroup } from "../lib/thread-groups";

export type ThreadsSidebarViewProps = {
  threads: ThreadSummary[];
  isLoading: boolean;
  loadFailure: ErrorDescription | null;
  onRetry: () => void;
  activeThreadId: string;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  /** Start a new conversation (the list's first row). */
  onNew: () => void;
  /** The clock the date groups are read against (stories pin it). */
  now?: number;
  className?: string;
};

type Row = { id: string; title: string; updatedAt: string };

export function ThreadsSidebarView({
  threads,
  isLoading,
  loadFailure,
  onRetry,
  activeThreadId,
  onSelect,
  onDelete,
  onNew,
  now,
  className,
}: ThreadsSidebarViewProps) {
  const { t } = useTranslation(["ai", "common"]);
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLocaleLowerCase();

  const groups = useMemo(() => {
    const untitled = t("agent.threads.untitled");
    // Stored threads only: a new conversation joins the list with its first turn.
    const rows: Row[] = threads.map((thread) => ({
      id: thread.id,
      title: thread.title?.trim() || untitled,
      updatedAt: thread.updatedAt ?? "",
    }));
    const matching = trimmed ? rows.filter((row) => row.title.toLocaleLowerCase().includes(trimmed)) : rows;
    return groupThreadsByDate(matching, now ?? Date.now());
  }, [threads, trimmed, now, t]);

  const groupLabel = (key: ThreadGroup<Row>["key"]) => {
    if (!key.startsWith("month:")) return t(`agent.threads.groups.${key as Exclude<typeof key, `month:${string}`>}`);
    const [year, month] = key.slice(6).split("-").map(Number);
    return formatDate(new Date(year!, month! - 1, 1), { year: "numeric", month: "long" });
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {/* One quiet row: the search, and New conversation at its end. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border py-1.5 pr-2 pl-4">
        <SearchField
          size="sm"
          variant="plain"
          className="min-w-0 flex-1"
          label={t("agent.threads.search")}
          placeholder={t("agent.threads.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Tooltip content={t("agent.threads.new")} side="bottom" align="end">
          <IconButton
            size="sm"
            label={t("agent.threads.new")}
            onClick={onNew}
            className="shrink-0 text-fg-muted hover:text-fg"
            icon={<NotePencil size={16} aria-hidden="true" />}
          />
        </Tooltip>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2 pt-1 pb-[calc(1rem+var(--ra-safe-bottom))]">
        {isLoading && threads.length === 0 ? (
          <div className="flex justify-center py-8">
            <Spinner size="sm" />
          </div>
        ) : loadFailure ? (
          <div className="px-2 py-4">
            <InlineError
              onRetry={loadFailure.retryable ? onRetry : undefined}
              retryLabel={t("common:errorBoundary.retry")}
            >
              {loadFailure.body}
            </InlineError>
          </div>
        ) : groups.length === 0 ? (
          <Body className="px-2 py-4 text-sm text-fg-muted">
            {trimmed ? t("agent.threads.noMatches", { query: query.trim() }) : t("agent.threads.empty")}
          </Body>
        ) : (
          groups.map((group) => (
            <section key={group.key} aria-label={groupLabel(group.key)} className="pt-3">
              <p className="px-2 pb-1 font-sans text-xs font-medium text-fg-subtle">{groupLabel(group.key)}</p>
              <ul className="flex flex-col gap-px">
                {group.items.map((row) => (
                  <ThreadRow
                    key={row.id}
                    title={row.title}
                    active={row.id === activeThreadId}
                    onSelect={() => onSelect(row.id)}
                    onDelete={() => onDelete(row.id)}
                    deleteLabel={t("agent.threads.delete")}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </ScrollArea>
    </div>
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
  deleteLabel: string;
}) {
  return (
    <li
      className={cn(
        "group flex items-center rounded-md transition-colors",
        active ? "bg-fill-strong" : "hover:bg-fill",
      )}
    >
      {/* oxlint-disable-next-line react/forbid-elements -- thread row sharing its hover surface with the row's delete action */}
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
        title={title}
        className={cn(
          "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left font-sans text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
          active ? "text-fg" : "text-fg-muted group-hover:text-fg",
        )}
      >
        {title}
      </button>
      {onDelete && (
        <IconButton
          size="sm"
          label={deleteLabel}
          onClick={onDelete}
          className="mr-0.5 shrink-0 text-fg-subtle opacity-0 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
          icon={<Trash size={13} aria-hidden="true" />}
        />
      )}
    </li>
  );
}
