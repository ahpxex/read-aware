import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import type { ComponentProps } from "react";
import { TextUnitReadoutChip } from "./TextUnitReadoutChip";

// useDraggableFloat clamps drags against a live container element, so the
// frame owns the ref and overrides the placeholder ref passed through args.
function FramedReadoutChip(props: ComponentProps<typeof TextUnitReadoutChip>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={containerRef}
      className="relative h-[16rem] overflow-hidden rounded-lg border border-border"
    >
      <TextUnitReadoutChip {...props} containerRef={containerRef} />
    </div>
  );
}

const meta = {
  title: "Interface/Reader/TextUnitReadoutChip",
  component: TextUnitReadoutChip,
  parameters: { layout: "fullscreen" },
  args: {
    visible: true,
    // Placeholder only — FramedReadoutChip substitutes its live ref.
    containerRef: { current: null },
    progress: { ordinal: 11, total: 87 },
    showProgress: true,
    sessionTimer: true,
  },
  render: (args) => <FramedReadoutChip {...args} />,
} satisfies Meta<typeof TextUnitReadoutChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Both readouts on: position and the ticking session clock share the chip. */
export const ProgressAndTimer: Story = {};

/** Progress alone — the divider and clock drop away. */
export const ProgressOnly: Story = {
  args: { sessionTimer: false },
};

/** Timer alone (progress display switched off in the plugin's settings). */
export const TimerOnly: Story = {
  args: { showProgress: false },
};
