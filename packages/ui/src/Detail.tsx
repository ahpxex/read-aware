import { type ReactNode } from "react";
import { Divider } from "./Divider";
import { ScrollArea } from "./ScrollArea";
import { Stack } from "./Stack";
import { cn } from "./lib/cn";

type DetailProps = {
  children: ReactNode;
  header?: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  scrollable?: boolean;
};

/**
 * A host-owned detail surface. Contextual controls occupy the trailing edge of
 * the heading row, while provenance and other secondary metadata stay quiet.
 */
export function Detail({
  children,
  header,
  metadata,
  actions,
  className,
  bodyClassName,
  scrollable = false,
}: DetailProps) {
  return (
    <Stack gap="lg" className={className}>
      {header ? (
        <Stack
          direction="horizontal"
          gap="sm"
          align="start"
          justify={actions ? "between" : "start"}
          className="w-full max-w-full"
        >
          <div className="min-w-0">{header}</div>
          {actions && <div className="shrink-0">{actions}</div>}
        </Stack>
      ) : actions ? (
        <Stack direction="horizontal" justify="end">
          {actions}
        </Stack>
      ) : null}
      {scrollable ? (
        <ScrollArea className={cn("min-h-0 min-w-0 flex-1", bodyClassName)}>
          {children}
        </ScrollArea>
      ) : (
        <div className={cn("min-w-0", bodyClassName)}>{children}</div>
      )}
      {metadata && (
        <Stack gap="md">
          <Divider />
          <footer>{metadata}</footer>
        </Stack>
      )}
    </Stack>
  );
}
