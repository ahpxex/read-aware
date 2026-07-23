import { Caption, Metadata, Stack } from "@read-aware/ui";
import { renderPluginIcon } from "../lib/plugin-icons";
import type { PluginMetadataItem } from "../lib/plugin-types";

type PluginMetadataProps = {
  items: PluginMetadataItem[];
  layout?: "vertical" | "horizontal";
};

export function PluginMetadata({ items, layout = "horizontal" }: PluginMetadataProps) {
  return (
    <Metadata layout={layout}>
      {items.map((item, index) => {
        if (item.kind === "divider") return <Metadata.Separator key={index} />;
        if (item.kind === "tags") {
          return <Metadata.Tags key={index} title={item.label} values={item.values} />;
        }
        return (
          <Metadata.Label
            key={index}
            title={item.label}
            value={item.value}
            icon={item.icon ? renderPluginIcon(item.icon, 15) : undefined}
          />
        );
      })}
    </Metadata>
  );
}

export function PluginMetadataLine({ items }: Pick<PluginMetadataProps, "items">) {
  const visibleItems = items.filter(
    (item): item is Exclude<PluginMetadataItem, { kind: "divider" }> =>
      item.kind !== "divider",
  );
  return (
    <Stack direction="horizontal" gap="md" align="center" wrap className="max-w-full">
      {visibleItems.map((item, index) => {
        const value = item.kind === "tags" ? item.values.join(", ") : item.value;
        const icon = item.kind === "label" && item.icon
          ? renderPluginIcon(item.icon, 13)
          : undefined;
        return (
          <span
            key={index}
            aria-label={`${item.label}: ${value}`}
            title={`${item.label}: ${value}`}
            className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-fg-subtle"
          >
            {icon && <span className="shrink-0">{icon}</span>}
            <Caption className="min-w-0 truncate text-fg-subtle">{value}</Caption>
          </span>
        );
      })}
    </Stack>
  );
}
