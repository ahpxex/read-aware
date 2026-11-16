import type { Meta, StoryObj } from "@storybook/react-vite";
import { DotsThreeVertical } from "@phosphor-icons/react";
import { DropdownMenu } from "./DropdownMenu";
import { buttonClassName } from "./Button";
import { iconButtonClassName } from "./IconButton";

const meta = {
  title: "Design System/Components/DropdownMenu",
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleItems = [
  { label: "Edit", onClick: () => {} },
  { label: "Duplicate", onClick: () => {} },
  { label: "Archive", onClick: () => {} },
  { label: "Delete", onClick: () => {}, destructive: true },
];

export const Default: Story = {
  args: {
    trigger: <span className={buttonClassName({ variant: "outline", size: "sm" })}>Actions</span>,
    items: sampleItems,
  },
};

export const RightAligned: Story = {
  render: (args) => (
    <div className="flex justify-end">
      <DropdownMenu {...args} />
    </div>
  ),
  args: {
    trigger: <span className={buttonClassName({ variant: "outline", size: "sm" })}>Actions</span>,
    items: sampleItems,
    align: "right",
  },
};

const MoreIcon = <DotsThreeVertical size={16} weight="bold" aria-hidden="true" />;

export const WithIconTrigger: Story = {
  args: {
    trigger: <span className={iconButtonClassName()}>{MoreIcon}</span>,
    triggerLabel: "More actions",
    items: [
      { label: "Share", onClick: () => {} },
      { label: "Export", onClick: () => {} },
      { label: "Print", onClick: () => {}, disabled: true },
    ],
  },
};

export const OpensUpward: Story = {
  render: (args) => (
    <div className="flex min-h-72 items-end justify-center">
      <DropdownMenu {...args} />
    </div>
  ),
  args: {
    trigger: <span className={iconButtonClassName()}>{MoreIcon}</span>,
    triggerLabel: "More actions",
    items: sampleItems,
    side: "top",
  },
};
