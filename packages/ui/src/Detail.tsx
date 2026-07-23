import { type ReactNode } from "react";
import { Divider } from "./Divider";
import { Stack } from "./Stack";

type DetailProps = {
  children: ReactNode;
  header?: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * A host-owned detail surface. Contextual actions stay beside the content
 * heading, while provenance and other secondary metadata form a quiet footer.
 */
export function Detail({
  children,
  header,
  metadata,
  actions,
  className,
}: DetailProps) {
  return (
    <Stack gap="lg" className={className}>
      {header ? (
        <Stack direction="horizontal" gap="sm" align="start" className="max-w-full self-start">
          <div className="min-w-0">{header}</div>
          {actions && <div className="shrink-0">{actions}</div>}
        </Stack>
      ) : actions ? (
        <Stack direction="horizontal" justify="end">
          {actions}
        </Stack>
      ) : null}
      <div className="min-w-0">{children}</div>
      {metadata && (
        <Stack gap="md">
          <Divider />
          <footer>{metadata}</footer>
        </Stack>
      )}
    </Stack>
  );
}
