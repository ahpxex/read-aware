import type { Meta, StoryObj } from "@storybook/react-vite";
import { barFill, DurationTooltip, INK } from "./ChartKit";

/**
 * ChartKit is the stats charts' shared vocabulary — ink colors, bar fills, and
 * the duration tooltip. The tooltip is the only rendering piece, so it anchors
 * the stories; the rest is shown as swatches so a palette change is visible
 * here before it reaches four charts.
 */
const meta = {
  title: "Interface/Stats/ChartKit",
  component: DurationTooltip,
  parameters: { layout: "padded" },
} satisfies Meta<typeof DurationTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The tooltip as the charts render it: a formatted duration on solid ink. */
export const Tooltip: Story = {
  args: {
    active: true,
    payload: [{ payload: { ms: 4_920_000, caption: "2026-06-24" } }],
  },
};

/** `sub` wins over `caption` when both are present. */
export const TooltipWithSubLabel: Story = {
  args: {
    active: true,
    payload: [{ payload: { ms: 1_500_000, sub: "18:00", caption: "18" } }],
  },
};

/** A bucket with no reading still formats rather than showing a bare zero. */
export const TooltipZeroDuration: Story = {
  args: { active: true, payload: [{ payload: { ms: 0, caption: "2026-06-21" } }] },
};

/** Inactive, or with nothing under the cursor, it renders nothing. */
export const TooltipInactive: Story = {
  args: { active: false, payload: [{ payload: { ms: 4_920_000 } }] },
};

/** The three bar states `barFill` produces, plus the raw ink tokens they use. */
export const Swatches: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <span className="mb-2 block text-xs text-fg-subtle">barFill</span>
        <div className="flex items-end gap-4">
          {[
            { label: "empty bucket", ms: 0, emphasized: false },
            { label: "normal", ms: 1, emphasized: false },
            { label: "emphasized", ms: 1, emphasized: true },
          ].map((bar) => (
            <div key={bar.label} className="flex flex-col items-center gap-1.5">
              <div
                style={{
                  width: 28,
                  height: 64,
                  backgroundColor: barFill(bar.ms, bar.emphasized),
                }}
              />
              <span className="text-[10px] text-fg-subtle">{bar.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <span className="mb-2 block text-xs text-fg-subtle">INK</span>
        <div className="flex gap-4">
          {Object.entries(INK).map(([name, value]) => (
            <div key={name} className="flex flex-col items-center gap-1.5">
              <div
                style={{
                  width: 40,
                  height: 40,
                  backgroundColor: value,
                  border: "1px solid var(--color-border)",
                }}
              />
              <code className="text-[10px] text-fg-muted">{name}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  ),
};
