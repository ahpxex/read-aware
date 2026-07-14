import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppearancePanel } from "./AppearancePanel";

const meta = {
  title: "Interface/Settings/AppearancePanel",
  component: AppearancePanel,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppearancePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The appearance section on jotai defaults: system theme, motion follows OS.
    Note: flipping controls writes through `appSettingsAtom` to this Storybook
    origin's localStorage — acceptable for a preview. */
export const Default: Story = {};
