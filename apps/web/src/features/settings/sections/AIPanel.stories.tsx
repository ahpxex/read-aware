import type { Meta, StoryObj } from "@storybook/react-vite";
import { AIPanel } from "./AIPanel";

const meta = {
  title: "Interface/Settings/AIPanel",
  component: AIPanel,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AIPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The AI section on jotai defaults: unconfigured BYOK connection form, all
    feature toggles on. Renders standalone — the connection "Test" button is the
    only live call, and it's user-triggered. Note: toggles write through
    `aiPreferencesAtom` (and Save writes the config) to this Storybook origin's
    localStorage. */
export const Default: Story = {};
