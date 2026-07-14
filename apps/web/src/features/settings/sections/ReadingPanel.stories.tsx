import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadingPanel } from "./ReadingPanel";

const meta = {
  title: "Interface/Settings/ReadingPanel",
  component: ReadingPanel,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ReadingPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The reading section on jotai defaults: live preview pinned on top, then
    typography, layout, and page-color choices. Note: changing controls writes
    through `readerPreferencesAtom` to this Storybook origin's localStorage. */
export const Default: Story = {};
