import type { Meta, StoryObj } from "@storybook/react-vite";
import { Radio } from "./Radio";

const meta = {
  title: "Design System/Components/Radio",
  component: Radio,
} satisfies Meta<typeof Radio>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Light mode",
    name: "theme",
  },
};

export const Checked: Story = {
  args: {
    label: "Light mode",
    name: "theme",
    defaultChecked: true,
  },
};

export const WithDescription: Story = {
  args: {
    label: "Compact view",
    description: "Show more items with smaller thumbnails",
    name: "view",
  },
};

export const Group: Story = {
  render: () => (
    <fieldset>
      <legend className="mb-3 font-sans text-[13px] font-medium text-stone-500">
        Reading speed
      </legend>
      <div className="flex flex-col gap-3">
        <Radio name="speed" label="Slow" description="~150 words per minute" />
        <Radio name="speed" label="Normal" description="~250 words per minute" defaultChecked />
        <Radio name="speed" label="Fast" description="~400 words per minute" />
      </div>
    </fieldset>
  ),
  args: { label: "", name: "" },
};
