import { Body, Caption } from "@read-aware/ui";

type StatTileProps = {
  label: string;
  value: string;
  /** Optional secondary line under the value (e.g. "best 12 days"). */
  hint?: string;
};

/** A single labelled figure in a stats grid. Quiet, tabular, editorial. */
export function StatTile({ label, value, hint }: StatTileProps) {
  return (
    <div className="min-w-0">
      <Caption className="block text-fg-subtle">{label}</Caption>
      <Body className="truncate text-sm font-medium tabular-nums text-fg">{value}</Body>
      {hint && <Caption className="block truncate text-fg-subtle">{hint}</Caption>}
    </div>
  );
}
