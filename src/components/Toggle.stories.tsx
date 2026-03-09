import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Toggle } from "./Toggle";

const meta = {
  title: "Design System/Components/Toggle",
  component: Toggle,
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {
  args: { label: "Dark mode", checked: false, onChange: () => {} },
};

export const On: Story = {
  args: { label: "Dark mode", checked: true, onChange: () => {} },
};

export const Interactive: Story = {
  args: { label: "Show annotations", checked: false, onChange: () => {} },
  render: (args) => {
    const [checked, setChecked] = useState(args.checked);
    return (
      <Toggle label={args.label} checked={checked} onChange={setChecked} />
    );
  },
};
