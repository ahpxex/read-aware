import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PluginSearchInput } from "./PluginSearchInput";

/** The search field shared by the installed-plugins list and the marketplace. */
const meta = {
  title: "Interface/Plugins/PluginSearchInput",
  component: PluginSearchInput,
  parameters: { layout: "padded" },
  args: {
    value: "",
    placeholder: "Search plugins",
    onChange: () => {},
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginSearchInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty, showing the placeholder that doubles as the field's accessible name. */
export const Empty: Story = {};

/** With a query typed in. */
export const WithQuery: Story = {
  args: { value: "dictionary" },
};

/** The marketplace uses its own placeholder, so the label follows it. */
export const MarketplacePlaceholder: Story = {
  args: { placeholder: "Search the marketplace", value: "rss" },
};

/** Live typing, to check the field stays controlled by its caller. */
export const Interactive: Story = {
  render: function Interactive(args) {
    const [value, setValue] = useState("");
    return <PluginSearchInput {...args} value={value} onChange={setValue} />;
  },
};
