import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsDialog } from "./SettingsDialog";

const meta = {
  title: "Interface/Settings/SettingsDialog",
  component: SettingsDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    onClose: () => {},
  },
} satisfies Meta<typeof SettingsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The full dialog held open: section nav with the sliding indicator on the
    left, the active panel on the right. All panels read jotai defaults; edits
    persist to this Storybook origin's localStorage. */
export const Default: Story = {};
