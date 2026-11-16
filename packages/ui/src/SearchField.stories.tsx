import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchField } from "./SearchField";

const meta = {
  title: "Design System/Components/SearchField",
  component: SearchField,
} satisfies Meta<typeof SearchField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Search saved words", placeholder: "Search saved words" },
};

export const Plain: Story = {
  args: { label: "Search commands", placeholder: "Search commands", variant: "plain" },
  decorators: [
    (Story) => (
      <div className="border-b border-border px-4 py-3">
        <Story />
      </div>
    ),
  ],
};

/**
 * A search that can be put away: the close control stands in for the browser's
 * clear button, and Escape closes too (without reaching an enclosing dialog).
 */
export const Dismissible: Story = {
  args: {
    label: "Search highlights and notes",
    placeholder: "Search highlights and notes",
    size: "sm",
    variant: "plain",
    defaultValue: "waxwing",
    onDismiss: () => {},
    dismissLabel: "Close search",
  },
};
