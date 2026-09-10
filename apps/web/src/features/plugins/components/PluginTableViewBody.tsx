import { ArrowsDownUp, CaretRight, SortAscending, SortDescending } from "@phosphor-icons/react";
import { Button, Caption, EmptyState, IconButton, Stack, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import type { PluginTableView } from "../lib/plugin-types";
import { PluginActionGroup } from "./PluginActionGroup";
import { PluginViewPagination } from "./PluginViewPagination";
import type { PluginResultRunner } from "./plugin-view-types";

export function PluginTableViewBody({ view, busy, onResult }: {
  view: PluginTableView;
  busy: boolean;
  onResult: PluginResultRunner;
}) {
  const { t } = useTranslation("plugins");
  const selectable = view.rows.some(row => row.onSelect);
  return (
    <Stack gap="sm" className="min-w-0 max-w-full">
      {view.actions?.length ? <PluginActionGroup actions={view.actions} busy={busy} align="end" display="icons" onResult={onResult} /> : null}
      <div className="max-w-full overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        role="region" tabIndex={0} aria-label={view.title ?? t("viewer.table.label")}>
        <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: `${view.columns.length * 9 + (selectable ? 3 : 0)}rem` }}
          aria-label={view.title ?? t("viewer.table.label")} aria-busy={busy}>
          {selectable && <colgroup>{view.columns.map(column => <col key={column.id} />)}<col style={{ width: "3rem" }} /></colgroup>}
          <thead>
            <tr className="border-b border-border">
              {view.columns.map(column => {
                const direction = view.sort?.value?.column === column.id ? view.sort.value.direction : undefined;
                const Icon = direction === "ascending" ? SortAscending : direction === "descending" ? SortDescending : ArrowsDownUp;
                return (
                  <th key={column.id} scope="col" aria-sort={column.sortable ? direction ?? "none" : undefined}
                    className={cn("px-3 py-2 font-medium", column.align === "end" ? "text-end" : "text-start")}>
                    {column.sortable && view.sort ? (
                      <Button variant="ghost" size="sm" disabled={busy} className="h-auto max-w-full whitespace-normal text-start"
                        onClick={() => void onResult(() => view.sort!.onChange({ column: column.id, direction: direction === "ascending" ? "descending" : "ascending" }), { navigation: "replace" })}>
                        <span className="min-w-0 break-words">{column.label}</span><Icon size={16} className="shrink-0" aria-hidden="true" />
                      </Button>
                    ) : <Caption as="span" className="break-words font-medium">{column.label}</Caption>}
                  </th>
                );
              })}
              {selectable && <th scope="col"><span className="sr-only">{t("viewer.table.open")}</span></th>}
            </tr>
          </thead>
          <tbody>
            {view.rows.map(row => (
              <tr key={row.id} className="border-b border-border/60">
                {view.columns.map(column => (
                  <td key={column.id} className={cn("px-3 py-3 align-top", column.align === "end" ? "text-end tabular-nums" : "text-start")}>
                    <Caption as="span" className="break-words whitespace-pre-wrap text-fg">{row.cells[column.id]}</Caption>
                  </td>
                ))}
                {selectable && <td className="px-1 py-2 align-top">
                  {row.onSelect && <Tooltip content={t("viewer.table.openItem", { label: row.label })}>
                    <IconButton size="sm" label={t("viewer.table.openItem", { label: row.label })} disabled={busy}
                      icon={<CaretRight size={16} aria-hidden="true" />}
                      onClick={() => void onResult(row.onSelect!, { presentation: row.presentation, dialogTitle: row.label })} />
                  </Tooltip>}
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.rows.length === 0 && <EmptyState title={view.emptyText ?? t("viewer.empty")} className="py-10" />}
      <PluginViewPagination pagination={view.pagination} busy={busy} onResult={onResult} />
    </Stack>
  );
}
