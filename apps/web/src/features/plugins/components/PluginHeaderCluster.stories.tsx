import type { Meta, StoryObj } from "@storybook/react-vite";
import { seed, withAtoms } from "../../../story-support/atoms";
import type { PluginHeaderSurface, RegisteredHeaderAction } from "../lib/plugin-types";
import { headerActionsAtom, pluginPlacementAtom } from "../state/plugin-store";
import { PluginHeaderCluster, PluginHeaderItem } from "./PluginHeaderCluster";
import { everyBlockKind } from "./plugin.fixtures";

function headerAction(
  id: string,
  title: string,
  icon: string,
  surface: PluginHeaderSurface,
  presentation: "popup" | "page" = "popup",
): RegisteredHeaderAction {
  return {
    id,
    title,
    icon,
    surface,
    presentation,
    key: `demo:${id}`,
    pluginId: "demo",
    pluginName: "Demo plugin",
    view: () => ({
      kind: "detail",
      title,
      content: everyBlockKind.slice(0, 5),
    }),
  };
}

const shelfActions = [
  headerAction("notebook", "Vocabulary notebook", "notebook", "shelf", "page"),
  headerAction("feeds", "Feeds", "rows", "shelf", "page"),
  headerAction("quick", "Quick lookup", "magnifying-glass", "shelf"),
  headerAction("stats", "Plugin stats", "chart-line-up", "shelf"),
];

const readerActions = [
  headerAction("lookup", "Look up", "magnifying-glass", "reader"),
  headerAction("speak", "Read aloud", "speaker", "reader"),
  headerAction("outline", "Outline", "list-bullets", "reader"),
];

const placement = (shelfHeader: string[], readerHeader: string[]) => ({
  shelfHeader,
  readerHeader,
  selection: [],
});

/**
 * Plugin icon buttons in a header bar. Pinned actions render inline — page
 * actions navigate, popup actions open an anchored Popover whose view loads on
 * open — and everything else collapses behind one overflow trigger. With no
 * contributions for the surface, the cluster renders nothing.
 *
 * `HEADER_PIN_LIMIT` caps how many pins are honoured, so a config listing more
 * than the limit still yields a bounded row.
 */
const meta = {
  title: "Interface/Plugins/PluginHeaderCluster",
  component: PluginHeaderCluster,
  parameters: { layout: "centered" },
  args: { surface: "shelf", onOpenPage: () => {} },
  decorators: [
    (Story) => (
      <div className="flex w-[28rem] items-center justify-end gap-1 rounded-md border border-border bg-surface px-3 py-2">
        <span className="mr-auto text-sm text-fg-subtle">Header</span>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginHeaderCluster>;

export default meta;
type Story = StoryObj<typeof meta>;
type ItemStory = StoryObj<typeof PluginHeaderItem>;

/** Nothing pinned: every contribution sits behind the overflow trigger. */
export const AllInOverflow: Story = {
  decorators: [
    withAtoms(
      seed(headerActionsAtom, shelfActions),
      seed(pluginPlacementAtom, placement([], [])),
    ),
  ],
};

/** Two pinned, two overflowed — the mixed row the shelf header usually shows. */
export const MixedPlacement: Story = {
  decorators: [
    withAtoms(
      seed(headerActionsAtom, shelfActions),
      seed(pluginPlacementAtom, placement(["demo:notebook", "demo:quick"], [])),
    ),
  ],
};

/** Everything pinned and nothing left over: no overflow trigger is drawn. */
export const AllPinned: Story = {
  decorators: [
    withAtoms(
      seed(headerActionsAtom, shelfActions.slice(0, 2)),
      seed(pluginPlacementAtom, placement(["demo:notebook", "demo:feeds"], [])),
    ),
  ],
};

/**
 * The reader surface, which never allows full-page interruptions — every
 * action there opens as an anchored popup.
 */
export const ReaderSurface: Story = {
  args: {
    surface: "reader",
    input: { book: { id: "b1", title: "Pale Fire", author: "Vladimir Nabokov" } },
  },
  decorators: [
    withAtoms(
      seed(headerActionsAtom, readerActions),
      seed(pluginPlacementAtom, placement([], ["demo:lookup"])),
    ),
  ],
};

/** A placement naming more pins than the limit allows is clamped, not honoured. */
export const MorePinsThanLimit: Story = {
  decorators: [
    withAtoms(
      seed(headerActionsAtom, shelfActions),
      seed(
        pluginPlacementAtom,
        placement(shelfActions.map((a) => a.key), []),
      ),
    ),
  ],
};

/** A pin naming an action that no longer exists is skipped, not rendered blank. */
export const StalePinnedKey: Story = {
  decorators: [
    withAtoms(
      seed(headerActionsAtom, shelfActions.slice(0, 2)),
      seed(pluginPlacementAtom, placement(["demo:uninstalled", "demo:notebook"], [])),
    ),
  ],
};

/** No contributions for this surface: the header is left exactly as it was. */
export const NoContributions: Story = {
  decorators: [
    withAtoms(
      seed(headerActionsAtom, []),
      seed(pluginPlacementAtom, placement([], [])),
    ),
  ],
};

/** A single item on its own — how the menu-config surfaces render these. */
export const SingleItemPageAction: ItemStory = {
  render: (args) => <PluginHeaderItem {...args} />,
  args: { action: shelfActions[0], onOpenPage: () => {} },
};

/** The popup variant of a single item, which loads its view when opened. */
export const SingleItemPopupAction: ItemStory = {
  render: (args) => <PluginHeaderItem {...args} />,
  args: { action: readerActions[0] },
};
