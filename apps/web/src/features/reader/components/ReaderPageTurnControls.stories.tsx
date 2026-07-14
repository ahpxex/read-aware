import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReaderPageTurnControls } from "./ReaderPageTurnControls";

const meta = {
  title: "Interface/Reader/ReaderPageTurnControls",
  component: ReaderPageTurnControls,
  parameters: { layout: "fullscreen" },
  args: {
    visible: true,
    onPrev: () => {},
    onNext: () => {},
  },
  decorators: [
    (Story) => (
      // The strips are absolute inset-y-0 edges; the frame is their positioned
      // ancestor and stands in for the reader canvas.
      <div className="relative h-[24rem] overflow-hidden rounded-lg border border-border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReaderPageTurnControls>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Paginated layout: caret buttons pinned to both edges (hidden on coarse pointers). */
export const Paginated: Story = {};
