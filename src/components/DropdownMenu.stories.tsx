import type { Meta, StoryObj } from "@storybook/react-vite";
import { DotsThreeVertical } from "@phosphor-icons/react";
import { DropdownMenu } from "./DropdownMenu";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

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
    trigger: <Button variant="outline" size="sm">Actions</Button>,
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
    trigger: <Button variant="outline" size="sm">Actions</Button>,
    items: sampleItems,
    align: "right",
  },
};

const MoreIcon = <DotsThreeVertical size={16} weight="bold" />;

export const WithIconTrigger: Story = {
  args: {
    trigger: <IconButton icon={MoreIcon} label="More actions" />,
    items: [
      { label: "Share", onClick: () => {} },
      { label: "Export", onClick: () => {} },
      { label: "Print", onClick: () => {}, disabled: true },
    ],
  },
};
