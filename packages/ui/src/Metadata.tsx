import { createContext, useContext, type ReactNode } from "react";
import { Divider } from "./Divider";
import { Stack } from "./Stack";
import { Tag } from "./Tag";
import { Body } from "./typography/Body";
import { Caption } from "./typography/Caption";

type MetadataProps = {
  children: ReactNode;
  layout?: "vertical" | "horizontal";
  className?: string;
};

type MetadataLabelProps = {
  title: string;
  value: ReactNode;
  icon?: ReactNode;
};

type MetadataTagsProps = {
  title: string;
  values: string[];
};

const MetadataLayoutContext = createContext<NonNullable<MetadataProps["layout"]>>("vertical");

export function Metadata({ children, layout = "vertical", className }: MetadataProps) {
  return (
    <MetadataLayoutContext.Provider value={layout}>
      <Stack
        direction={layout === "horizontal" ? "horizontal" : "vertical"}
        gap={layout === "horizontal" ? "lg" : "md"}
        align={layout === "horizontal" ? "center" : "stretch"}
        wrap={layout === "horizontal"}
        className={className}
      >
        {children}
      </Stack>
    </MetadataLayoutContext.Provider>
  );
}

function MetadataLabel({ title, value, icon }: MetadataLabelProps) {
  const layout = useContext(MetadataLayoutContext);

  if (layout === "horizontal") {
    return (
      <Stack direction="horizontal" gap="sm" align="center" className="min-w-0">
        {icon && <span className="shrink-0 text-fg-subtle">{icon}</span>}
        <Stack direction="horizontal" gap="xs" align="baseline" className="min-w-0">
          <Caption className="shrink-0 text-fg-subtle">{title}</Caption>
          <Body className="min-w-0 text-sm leading-6 text-fg">{value}</Body>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack gap="xs">
      <Caption className="text-fg-subtle">{title}</Caption>
      <Stack direction="horizontal" gap="sm" align="center">
        {icon && <span className="shrink-0 text-fg-subtle">{icon}</span>}
        <Body className="min-w-0 text-sm leading-6 text-fg">{value}</Body>
      </Stack>
    </Stack>
  );
}

function MetadataTags({ title, values }: MetadataTagsProps) {
  const layout = useContext(MetadataLayoutContext);

  return (
    <Stack
      direction={layout === "horizontal" ? "horizontal" : "vertical"}
      gap="sm"
      align={layout === "horizontal" ? "center" : "stretch"}
    >
      <Caption className={layout === "horizontal" ? "shrink-0 text-fg-subtle" : "text-fg-subtle"}>
        {title}
      </Caption>
      <Stack direction="horizontal" gap="sm" align="center" wrap>
        {values.map((value) => (
          <Tag key={value}>{value}</Tag>
        ))}
      </Stack>
    </Stack>
  );
}

function MetadataSeparator() {
  const layout = useContext(MetadataLayoutContext);
  return layout === "horizontal"
    ? <Divider className="h-4 self-center border-l border-t-0" />
    : <Divider />;
}

Metadata.Label = MetadataLabel;
Metadata.Tags = MetadataTags;
Metadata.Separator = MetadataSeparator;
