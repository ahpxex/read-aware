import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextArea } from "./TextArea";

const meta = {
  title: "Design System/Components/TextArea",
  component: TextArea,
} satisfies Meta<typeof TextArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Notes", placeholder: "Add your notes here" },
};

export const WithValue: Story = {
  args: {
    label: "Summary",
    defaultValue:
      "The layout stays quiet so the collection can breathe. Titles, sequence, and open margins do the work.",
  },
};
