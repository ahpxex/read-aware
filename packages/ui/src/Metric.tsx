import { type ReactNode } from "react";
import { cn } from "./lib/cn";
import { Stack } from "./Stack";
import { Body } from "./typography/Body";
import { Caption } from "./typography/Caption";

type MetricProps = {
  label: string;
  value: ReactNode;
  description?: ReactNode;
  className?: string;
};

export function Metric({ label, value, description, className }: MetricProps) {
  return (
    <Stack gap="xs" className={cn("min-w-0", className)}>
      <Caption className="text-fg-subtle">{label}</Caption>
      <Body className="truncate font-serif text-2xl leading-tight text-fg tabular-nums">
        {value}
      </Body>
      {description && <Caption className="text-fg-muted">{description}</Caption>}
    </Stack>
  );
}
