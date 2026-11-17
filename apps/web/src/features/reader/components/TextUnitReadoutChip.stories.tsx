import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import type { ComponentProps } from "react";
import { ActiveReadingClock } from "../lib/reading-session-policy";
import { TextUnitReadoutChip } from "./TextUnitReadoutChip";

// useDraggableFloat clamps drags against a live container element, and the
// timer needs a live reading clock, so the frame owns both and overrides the
// placeholders passed through args.
function FramedReadoutChip(props: ComponentProps<typeof TextUnitReadoutChip>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [readingClock] = useState(() => new ActiveReadingClock(performance.now(), true));
  return (
    <div ref={containerRef} className="relative h-[16rem] overflow-hidden rounded-surface border border-border">
      <TextUnitReadoutChip {...props} containerRef={containerRef} readingClock={readingClock} />
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
    // Placeholder only — FramedReadoutChip substitutes a live clock.
    readingClock: null,
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
