import type { Meta, StoryObj } from "@storybook/react";
import { SettingsView } from "../features/settings/SettingsView";

const meta: Meta = {
  title: "Interface/Settings",
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => <SettingsView onBack={() => {}} />,
};
