import type { Meta, StoryObj } from "@storybook/react-vite";
import { seed, withAtoms } from "../../../story-support/atoms";
import { defaultHeaderFooterSettings } from "../../../domain/settings/header-footer-settings";
import { headerFooterSettingsAtom } from "../../../state/ui";
import { HeaderFooterEditor } from "./HeaderFooterEditor";

/**
 * The reader header/footer arrangement editor: a miniature page whose six
 * strip positions accept chips dragged from one another or from the "Not
 * shown" tray. The settings atom is seeded so the story does not depend on
 * this origin's localStorage.
 */
const meta = {
  title: "Interface/Menus/HeaderFooterEditor",
  component: HeaderFooterEditor,
  parameters: { layout: "padded" },
  decorators: [
    withAtoms(seed(headerFooterSettingsAtom, { ...defaultHeaderFooterSettings(), enabled: true })),
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HeaderFooterEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Defaults: chapter top-left, time+battery bottom-left, progress bottom-right. */
export const Default: Story = {};

/** Everything hidden: every chip waits in the tray and the page is bare. */
export const AllHidden: Story = {
  decorators: [
    withAtoms(
      seed(headerFooterSettingsAtom, {
        enabled: true,
        slots: {
          "header-left": [],
          "header-center": [],
          "header-right": [],
          "footer-left": [],
          "footer-center": [],
          "footer-right": [],
        },
      }),
    ),
  ],
};

/** The strips disabled: the editor dims and the switch is the only live part. */
export const Disabled: Story = {
  decorators: [withAtoms(seed(headerFooterSettingsAtom, { ...defaultHeaderFooterSettings(), enabled: false }))],
};
