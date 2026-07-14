import type { Meta, StoryObj } from "@storybook/react-vite";
import { GeneralPanel } from "./GeneralPanel";

const meta = {
  title: "Interface/Settings/GeneralPanel",
  component: GeneralPanel,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GeneralPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The general section on jotai defaults: start view, desktop integration,
    language + privacy. Note: changing controls writes through
    `generalSettingsAtom` to this Storybook origin's localStorage (and the
    language select switches Storybook's live i18n locale). */
export const Default: Story = {};
