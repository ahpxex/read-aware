import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./Checkbox";

const meta = {
  title: "Design System/Components/Checkbox",
  component: Checkbox,
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Mark as read",
  },
};

export const Checked: Story = {
  args: {
    label: "Mark as read",
    defaultChecked: true,
  },
};

export const WithDescription: Story = {
  args: {
    label: "Enable notifications",
    description: "Receive alerts when new items are added to your shelf",
  },
};

export const Disabled: Story = {
  args: {
    label: "Archived",
    disabled: true,
    defaultChecked: true,
  },
};

export const Group: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Checkbox label="Fiction" defaultChecked />
      <Checkbox label="Non-fiction" />
      <Checkbox label="Poetry" />
      <Checkbox label="Essays" defaultChecked />
    </div>
  ),
  args: { label: "" },
};
