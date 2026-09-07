import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SearchSelect } from "./SearchSelect";

const meta = {
  title: "Design System/Components/SearchSelect",
  component: SearchSelect,
  args: {
    label: "Sort by",
    value: "title",
    options: [
      { value: "date", label: "Date added" },
      { value: "title", label: "Title" },
      { value: "author", label: "Author" },
    ],
    onChange: () => {},
    searchLabel: "Search options",
    emptyText: "No matches",
  },
  decorators: [(Story) => <div className="max-w-sm"><Story /></div>],
} satisfies Meta<typeof SearchSelect>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const RetainedSelection: Story = { args: { value: "previous-selection" } };
export const Empty: Story = { args: { value: "", options: [], placeholder: "Choose" } };
export const CustomValue: Story = { args: { customLabel: (value) => `Use ${value}` } };
export const Controlled: Story = {
  render: function Controlled(args) {
    const [value, setValue] = useState(args.value);
    return <SearchSelect {...args} value={value} onChange={setValue} />;
  },
};
