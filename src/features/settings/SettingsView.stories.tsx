import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsView } from "./SettingsView";

const meta = {
  title: "Features/Settings/SettingsView",
  component: SettingsView,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SettingsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shell: Story = {};
