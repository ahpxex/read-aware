import type { Meta, StoryObj } from "@storybook/react-vite";
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

const MoreIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <circle cx="8" cy="3" r="1.5" />
    <circle cx="8" cy="8" r="1.5" />
    <circle cx="8" cy="13" r="1.5" />
  </svg>
);

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
