import type { Meta, StoryObj } from "@storybook/react-vite";
import { seed, withAtoms } from "../../../story-support/atoms";
import type { RegisteredHeaderAction } from "../../plugins/lib/plugin-types";
import { headerActionsAtom, selectionActionsAtom } from "../../plugins/state/plugin-store";
import { MenusPanel } from "./MenusPanel";

const headerActions: RegisteredHeaderAction[] = [
  {
    id: "notebook",
    title: "Vocabulary notebook",
    icon: "notebook",
    surface: "shelf",
    presentation: "page",
    key: "vocab:notebook",
    pluginId: "vocab",
    pluginName: "Vocabulary",
    view: () => ({ kind: "detail", content: [] }),
  },
  {
    id: "aloud",
    title: "Read aloud",
    icon: "speaker",
    surface: "reader",
    presentation: "popup",
    key: "tts:aloud",
    pluginId: "tts",
    pluginName: "Text to speech",
    view: () => ({ kind: "detail", content: [] }),
  },
];

/**
 * Settings → Customize: all four arrangeable surfaces, stacked. The panel is
 * only a frame around `MenuSurfaceEditor`, so the interesting per-surface
 * states live in that component's stories; what this one shows is the whole
 * page's rhythm.
 *
 * The layout comes from this Storybook origin's own stored config, which the
 * editors write through to as you drag.
 */
const meta = {
  title: "Interface/Settings/MenusPanel",
  component: MenusPanel,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MenusPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** With a couple of plugin contributions available to place. */
export const WithPlugins: Story = {
  decorators: [
    withAtoms(
      seed(headerActionsAtom, headerActions),
      seed(selectionActionsAtom, []),
    ),
  ],
};

/** A clean install: core items only. */
export const WithoutPlugins: Story = {
  decorators: [
    withAtoms(seed(headerActionsAtom, []), seed(selectionActionsAtom, [])),
  ],
};
