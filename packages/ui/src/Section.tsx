import { type ReactNode } from "react";
import { Body } from "./typography/Body";
import { Eyebrow } from "./typography/Eyebrow";
import { Stack } from "./Stack";

type SectionProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** A quiet content section whose hierarchy and spacing stay host-owned. */
export function Section({ title, description, actions, children, className }: SectionProps) {
  const hasHeader = Boolean(title || description || actions);

  return (
    <section className={className}>
      {hasHeader && (
        <Stack
          direction="horizontal"
          gap="md"
          align="start"
          justify="between"
          className="mb-3"
        >
          <Stack gap="xs" className="min-w-0">
            {title && <Eyebrow>{title}</Eyebrow>}
            {description && <Body className="text-sm text-fg-muted">{description}</Body>}
          </Stack>
          {actions && <div className="shrink-0">{actions}</div>}
        </Stack>
      )}
      {children}
    </section>
  );
}
