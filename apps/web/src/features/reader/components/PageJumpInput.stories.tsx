import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageJumpInput } from "./PageJumpInput";

const meta = {
  title: "Interface/Reader/PageJumpInput",
  component: PageJumpInput,
  args: {
    numPages: 312,
    currentPage: 42,
    onJump: () => {},
  },
  decorators: [
    (Story) => (
      // The form stretches to its container; in product it sits in a narrow popover.
      <div className="max-w-56">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PageJumpInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Mid-book: the current page prefilled, focused and selected on mount. */
export const MidBook: Story = {};

/** At the last page of a short document — the upper bound submits clamp against. */
export const LastPageOfShortBook: Story = {
  args: { numPages: 12, currentPage: 12 },
};

/** Single-page document: 1 of 1 is the only valid jump. */
export const SinglePage: Story = {
  args: { numPages: 1, currentPage: 1 },
};
