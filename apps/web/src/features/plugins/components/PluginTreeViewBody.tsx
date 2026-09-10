import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { Caption, EmptyState, IconButton, Stack, Tooltip } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { PluginTreeView } from "../lib/plugin-types";
import { renderPluginIcon } from "../lib/plugin-icons";
import { usePluginTree } from "../hooks/usePluginTree";
import { PluginActionGroup } from "./PluginActionGroup";
import { PluginViewPagination } from "./PluginViewPagination";
import type { PluginResultRunner } from "./plugin-view-types";

export function PluginTreeViewBody({ view, busy, onResult }: {
  view: PluginTreeView; busy: boolean; onResult: PluginResultRunner;
}) {
  const { t } = useTranslation("plugins");
  const tree = usePluginTree(view, busy, onResult);
  return <Stack gap="sm" className="min-w-0 max-w-full">
    {view.actions?.length ? <PluginActionGroup actions={view.actions} busy={busy} align="end" display="icons" onResult={onResult} /> : null}
    <div role="tree" aria-label={view.title} aria-busy={busy} className="min-w-0"
      onFocusCapture={() => { tree.ownsFocus.current = true; }}
      onBlurCapture={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) tree.ownsFocus.current = false;
      }}>
      {tree.rows.map((row, index) => {
        const { node } = row, branch = !!node.children?.length, expanded = branch && tree.expanded.has(node.id);
        const label = t(expanded ? "viewer.tree.collapse" : "viewer.tree.expand", { label: node.title });
        return <div key={node.id} role="treeitem" aria-label={node.title}
          aria-level={row.level} aria-posinset={row.position} aria-setsize={row.size}
          aria-expanded={branch ? expanded : undefined} aria-disabled={busy || undefined}
          tabIndex={tree.focusedId === node.id ? 0 : -1}
          ref={element => { if (element) tree.elements.current.set(node.id, element); else tree.elements.current.delete(node.id); }}
          onFocus={event => { if (event.target === event.currentTarget && tree.focusedId !== node.id) tree.focus(node.id); }}
          onKeyDown={event => tree.keyDown(event, row, index)}
          onClick={() => tree.activate(row)}
          className="flex min-h-10 min-w-0 items-start gap-2 rounded-sm py-1 pe-2 text-fg hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-strong"
          style={{ paddingInlineStart: `${(row.level - 1) * 12}px` }}>
          {branch ? <Tooltip content={label}><IconButton size="sm" label={label} tabIndex={-1} disabled={busy}
            icon={expanded ? <CaretDown size={16} /> : <CaretRight size={16} />}
            onClick={event => { event.stopPropagation(); tree.toggle(row); }} /></Tooltip>
            : <span className="size-8 shrink-0" aria-hidden="true" />}
          {node.icon && <span className="mt-2 shrink-0" aria-hidden="true">{renderPluginIcon(node.icon, 16)}</span>}
          <Stack gap="xs" className="min-w-0 flex-1 py-1.5">
            <Caption as="span" className="break-words whitespace-pre-wrap text-fg">{node.title}</Caption>
            {node.subtitle && <Caption as="span" className="break-words whitespace-pre-wrap text-fg-muted">{node.subtitle}</Caption>}
          </Stack>
        </div>;
      })}
    </div>
    {tree.rows.length === 0 && <EmptyState title={view.emptyText ?? t("viewer.empty")} className="py-10" />}
    <PluginViewPagination pagination={view.pagination} busy={busy} onResult={onResult} />
  </Stack>;
}
