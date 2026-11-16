import type { Meta, StoryObj } from "@storybook/react-vite";
import { Minus, Square, X } from "@phosphor-icons/react";
import { IconButton } from "./IconButton";

const meta = {
  title: "Design System/Components/IconButton",
  component: IconButton,
  argTypes: {
    size: { control: "select", options: ["sm", "md", "toolbar", "caption"] },
    tone: { control: "select", options: ["default", "danger", "close"] },
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { icon: <X size={16} weight="regular" />, label: "Close" },
};

export const Small: Story = {
  args: { icon: <X size={16} weight="regular" />, label: "Close", size: "sm" },
};

/** Window caption controls: full-height slots flush with the header's corner. */
export const CaptionSlots: Story = {
  args: { icon: <X size={15} weight="regular" />, label: "Close", size: "caption", tone: "close" },
  render: (args) => (
    <div className="flex h-10 items-stretch justify-end border-b border-border">
      <IconButton {...args} icon={<Minus size={14} weight="regular" />} label="Minimize" tone="default" />
      <IconButton {...args} icon={<Square size={13} weight="regular" />} label="Maximize" tone="default" />
      <IconButton {...args} />
    </div>
  ),
};

/** Toolbar slots: each button fills an equal share of a phone bottom toolbar. */
export const ToolbarSlots: Story = {
  args: { icon: <X size={20} weight="regular" />, label: "Close", size: "toolbar" },
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: (args) => (
    <div className="grid w-full max-w-sm grid-cols-5 border-t border-border bg-fill px-1">
      {Array.from({ length: 5 }, (_, i) => (
        <IconButton key={i} {...args} className={i === 1 ? "text-fg" : undefined} />
      ))}
    </div>
  ),
};
