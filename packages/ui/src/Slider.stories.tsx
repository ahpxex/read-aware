import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Slider } from "./Slider";

const meta = {
  title: "Components/Slider",
  component: Slider,
  args: { label: "Font size", min: 12, max: 40, step: 1, value: 18 },
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

function DefaultDemo() {
  const [value, setValue] = useState(18);
  return <Slider label="Font size" value={value} min={12} max={40} step={1} onChange={setValue} />;
}

export const Default: Story = { render: () => <DefaultDemo /> };

function UnitsDemo() {
  const [value, setValue] = useState(8);
  return (
    <Slider
      label="Page margins"
      value={value}
      min={0}
      max={25}
      step={1}
      onChange={setValue}
      formatValue={(v) => `${v}%`}
    />
  );
}

export const WithUnits: Story = { render: () => <UnitsDemo /> };

export const Disabled: Story = {
  args: { disabled: true, value: 22 },
};
