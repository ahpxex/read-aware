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
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
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

/**
 * Sections from `group`, a per-row accessory, a pinned footer, and
 * `matchValue={false}` — the values are refs (`curated:…`, `system:…`), so a
 * query matches labels only and can never hit a ref fragment.
 */
export const GroupedWithFooter: Story = {
  args: {
    label: "Font",
    value: "curated:serif4",
    matchValue: false,
    options: [
      { value: "curated:literata", label: "Literata" },
      { value: "curated:serif4", label: "Source Serif 4" },
      {
        value: "user:aaa",
        label: "Alegreya Sans",
        group: "Imported fonts",
        accessory: <span className="text-[11px] text-fg-subtle">TTF · 471 KB</span>,
      },
      { value: "system:iowan", label: "Iowan Old Style", group: "Installed on this device" },
      { value: "system:avenir", label: "Avenir Next", group: "Installed on this device" },
    ],
    footer: (close) => (
      <button
        type="button"
        onClick={close}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-fill hover:text-fg"
      >
        Import font…
      </button>
    ),
  },
};
