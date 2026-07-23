import { ListBullets } from "@phosphor-icons/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Caption,
  EmptyState,
  ItemList,
  SearchField,
  Section,
  Stack,
  Tabs,
  Tag,
  Tooltip,
} from "@read-aware/ui";
import { useLocale, useTranslation } from "../../../i18n";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { renderPluginIcon } from "../lib/plugin-icons";
import {
  filterPluginTimelineItems,
  groupPluginTimelineItems,
  type PluginTimelineRange,
} from "../lib/plugin-timeline";
import type { PluginListAccessory, PluginListItem, PluginListView } from "../lib/plugin-types";
import { PluginActionGroup } from "./PluginActionGroup";
import type { PluginResultRunner } from "./plugin-view-types";

type PluginListViewBodyProps = {
  view: PluginListView;
  busy: boolean;
  onResult: PluginResultRunner;
};

const SEARCH_DEBOUNCE_MS = 200;
const TIMELINE_RANGES: PluginTimelineRange[] = ["today", "week", "month", "all"];

function accessoryNode(accessory: PluginListAccessory, index: number) {
  if (accessory.kind === "text") {
    return (
      <Caption key={index} className="max-w-32 truncate text-fg-subtle">
        {accessory.text}
      </Caption>
    );
  }
  if (accessory.kind === "tag") return <Tag key={index}>{accessory.text}</Tag>;
  const icon = renderPluginIcon(accessory.icon, 14);
  return accessory.label ? (
    <Tooltip key={index} content={accessory.label} side="top">
      {icon}
    </Tooltip>
  ) : (
    <Fragment key={index}>{icon}</Fragment>
  );
}

export function PluginListViewBody({ view, busy, onResult }: PluginListViewBodyProps) {
  const { t } = useTranslation("plugins");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  useEffect(() => setQuery(""), [view]);

  const items = useMemo(() => {
    const needle = debouncedQuery.trim().toLocaleLowerCase();
    if (!needle) return view.items;
    return view.items.filter((item) =>
      [item.title, item.subtitle, ...(item.keywords ?? [])]
        .filter((part): part is string => Boolean(part))
        .some((part) => part.toLocaleLowerCase().includes(needle)),
    );
  }, [debouncedQuery, view.items]);

  const renderItems = (visibleItems: PluginListItem[]) => (
    <ItemList>
      {visibleItems.map((item) => (
        <ItemList.Item
          key={item.id}
          title={item.title}
          subtitle={item.subtitle}
          icon={renderPluginIcon(item.icon, 16)}
          accessories={item.accessories?.map(accessoryNode)}
          disclosure={item.presentation === "dialog" ? "none" : "chevron"}
          disabled={busy}
          onClick={
            item.onSelect
              ? () => void onResult(
                  () => item.onSelect!(),
                  { presentation: item.presentation, dialogTitle: item.title },
                )
              : undefined
          }
        />
      ))}
    </ItemList>
  );

  const timelineTabs = view.timeline
    ? TIMELINE_RANGES.map((range) => {
        const rangeItems = filterPluginTimelineItems(items, range);
        const sections = groupPluginTimelineItems(
          rangeItems,
          locale,
          {
            today: t("viewer.timeline.today"),
            yesterday: t("viewer.timeline.yesterday"),
            unknownDate: t("viewer.timeline.unknownDate"),
          },
        );
        return {
          label: t(`viewer.timeline.${range}`),
          content:
            sections.length === 0 ? (
              <EmptyState
                title={
                  debouncedQuery.trim()
                    ? t("viewer.noMatches")
                    : t("viewer.timeline.noItems")
                }
                className="py-10"
              />
            ) : (
              <Stack gap="lg">
                {sections.map((section) => (
                  <Section key={section.key} title={section.label}>
                    {renderItems(section.items)}
                  </Section>
                ))}
              </Stack>
            ),
        };
      })
    : [];

  const listActions = view.actions?.length ? (
    <PluginActionGroup
      actions={view.actions}
      busy={busy}
      align="end"
      display="icons"
      onResult={onResult}
    />
  ) : null;

  if (view.items.length === 0) {
    return (
      <EmptyState
        icon={<ListBullets size={28} weight="regular" aria-hidden="true" />}
        title={view.emptyText ?? t("viewer.empty")}
        className="py-10"
      />
    );
  }

  return (
    <Stack gap="md">
      {view.searchable && (
        <SearchField
          label={view.searchPlaceholder ?? t("viewer.search")}
          placeholder={view.searchPlaceholder ?? t("viewer.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}

      {view.timeline ? (
        <Tabs
          items={timelineTabs}
          defaultIndex={TIMELINE_RANGES.indexOf("all")}
          ariaLabel={t("viewer.timeline.filter")}
          trailing={listActions}
        />
      ) : items.length === 0 ? (
        <EmptyState title={t("viewer.noMatches")} className="py-10" />
      ) : (
        <Stack gap="sm">
          {listActions}
          {renderItems(items)}
        </Stack>
      )}
    </Stack>
  );
}
