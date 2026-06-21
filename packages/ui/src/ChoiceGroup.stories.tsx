import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Rows, SquaresFour } from "@phosphor-icons/react";
import { ChoiceGroup } from "./ChoiceGroup";

const meta = {
  title: "Design System/Components/ChoiceGroup",
  component: ChoiceGroup,
} satisfies Meta<typeof ChoiceGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState("warm");
    return (
      <ChoiceGroup
        label="Theme"
        value={value}
        onChange={setValue}
        options={[
          { value: "light", label: "Light" },
          { value: "warm", label: "Warm" },
          { value: "dark", label: "Dark" },
        ]}
      />
    );
  },
};

export const WithIcons: Story = {
  render: () => {
    const [value, setValue] = useState("grid");
    return (
      <ChoiceGroup
        label="Layout"
        value={value}
        onChange={setValue}
        options={[
          { value: "grid", label: "Grid", icon: <SquaresFour size={15} weight="regular" /> },
          { value: "list", label: "List", icon: <Rows size={15} weight="regular" /> },
        ]}
      />
    );
  },
};
