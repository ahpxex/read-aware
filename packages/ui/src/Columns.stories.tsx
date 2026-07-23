import type { Meta, StoryObj } from "@storybook/react-vite";
import { Columns } from "./Columns";
import { Metric } from "./Metric";

const meta = {
  title: "Design System/Components/Columns",
  component: Columns,
} satisfies Meta<typeof Columns>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Weighted: Story = {
  args: {
    children: (
      <>
        <Columns.Item weight={2}><Metric label="Reading time" value="18h 24m" /></Columns.Item>
        <Columns.Item><Metric label="Books" value="12" /></Columns.Item>
        <Columns.Item><Metric label="Notes" value="47" /></Columns.Item>
      </>
    ),
  },
};
