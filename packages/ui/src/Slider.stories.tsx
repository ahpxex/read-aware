import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, useState } from "react";
import { Slider } from "./Slider";

function StatefulSlider(args: ComponentProps<typeof Slider>) {
  const [value, setValue] = useState(args.value);
  return <Slider {...args} value={value} onChange={setValue} />;
}

const meta = {
  title: "Components/Slider",
  component: Slider,
  args: { label: "Font size", min: 12, max: 40, step: 1, value: 18, onChange: () => {} },
  render: (args) => <StatefulSlider {...args} />,
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithUnits: Story = {
  args: { label: "Page margins", min: 0, max: 25, value: 8, formatValue: (v) => `${v}%` },
};

export const Disabled: Story = {
  args: { disabled: true, value: 22 },
};
