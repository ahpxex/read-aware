import type { Meta, StoryObj } from "@storybook/react-vite";
import { ShortcutsPanel } from "./ShortcutsPanel";

const meta = {
  title: "Interface/Settings/ShortcutsPanel",
  component: ShortcutsPanel,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ShortcutsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shortcuts section on jotai defaults: every category with its default
    chords, no overrides. Note: rebinding a shortcut writes through
    `shortcutBindingsAtom` to this Storybook origin's localStorage. */
export const Default: Story = {};
