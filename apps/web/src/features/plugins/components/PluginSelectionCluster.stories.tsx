import type { Meta, StoryObj } from "@storybook/react-vite";
import { menuConfigAtom, pluginMenuId } from "../../menus/state/menu-config";
import type { MenuConfig } from "../../menus/state/menu-config";
import { seed, withAtoms } from "../../../story-support/atoms";
import type { RegisteredSelectionAction } from "../lib/plugin-types";
import { selectionActionsAtom } from "../state/plugin-store";
import { PluginSelectionCluster } from "./PluginSelectionCluster";

function action(
  id: string,
  title: string,
  icon: string,
  role?: "lookup",
): RegisteredSelectionAction {
  return {
    id,
    title,
    icon,
    role,
    key: `demo:${id}`,
    pluginId: "demo",
    pluginName: "Demo plugin",
    run: () => undefined,
  };
}

const actions = [
  action("lookup", "Look up", "magnifying-glass", "lookup"),
  action("translate", "Translate", "translate"),
  action("speak", "Read aloud", "speaker"),
  action("save", "Save to notebook", "notebook"),
];

/** A menu config that pins some contributions inline and overflows the rest. */
function layout(visible: string[], overflow: string[]): MenuConfig {
  const empty = { visible: [], overflow: [] };
  return {
    primaryNav: empty,
    shelfHeader: empty,
    readerHeader: empty,
    selection: { visible, overflow },
  };
}

const input = {
  text: "waxwing",
  context: "I was the shadow of the waxwing slain",
  cfiRange: "epubcfi(/6/14!/4/2/2,/1:0,/1:34)",
  chapterHref: "chapter-1.xhtml",
  book: { id: "book-1", title: "Pale Fire", author: "Vladimir Nabokov" },
  source: "selection" as const,
};

/**
 * Plugin actions inside the reader's selection menu. Placement is user-owned:
 * whatever the menu config pins renders inline as an icon button, and the rest
 * collapses behind one puzzle-piece overflow trigger. With no contributions
 * registered the cluster renders nothing at all, leaving the built-in menu
 * untouched — that is the "NoContributions" story.
 */
const meta = {
  title: "Interface/Plugins/PluginSelectionCluster",
  component: PluginSelectionCluster,
  parameters: { layout: "centered" },
  args: { input },
  decorators: [
    (Story) => (
      <div className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1.5 shadow-md">
        <span className="px-1 text-xs text-fg-subtle">built-in actions</span>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginSelectionCluster>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default placement: only `role: "lookup"` actions are pinned, so one button
 * shows inline and the rest sit behind the overflow.
 */
export const DefaultPlacement: Story = {
  decorators: [
    withAtoms(
      seed(selectionActionsAtom, actions),
      seed(menuConfigAtom, layout([], [])),
    ),
  ],
};

/** Everything pinned inline — the user promoted all four. */
export const AllPinned: Story = {
  decorators: [
    withAtoms(
      seed(selectionActionsAtom, actions),
      seed(menuConfigAtom, layout(actions.map((a) => pluginMenuId(a.key)), [])),
    ),
  ],
};

/** Everything demoted: a single overflow trigger, and nothing else. */
export const AllInOverflow: Story = {
  decorators: [
    withAtoms(
      seed(selectionActionsAtom, actions),
      seed(menuConfigAtom, layout([], actions.map((a) => pluginMenuId(a.key)))),
    ),
  ],
};

/** One contribution, pinned — no overflow trigger is drawn at all. */
export const SingleAction: Story = {
  decorators: [
    withAtoms(
      seed(selectionActionsAtom, [actions[0]]),
      seed(menuConfigAtom, layout([pluginMenuId(actions[0].key)], [])),
    ),
  ],
};

/** With the caller's divider, drawn only because contributions exist. */
export const WithDivider: Story = {
  args: {
    divider: <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />,
  },
  decorators: [
    withAtoms(
      seed(selectionActionsAtom, actions),
      seed(menuConfigAtom, layout([pluginMenuId(actions[0].key)], [])),
    ),
  ],
};

/** Bottom-anchored toolbars open the overflow upward instead. */
export const OverflowOpensUpward: Story = {
  args: { overflowSide: "top" },
  decorators: [
    withAtoms(
      seed(selectionActionsAtom, actions),
      seed(menuConfigAtom, layout([], [])),
    ),
  ],
};

/** No plugin contributes: nothing renders, not even the divider. */
export const NoContributions: Story = {
  args: { divider: <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" /> },
  decorators: [
    withAtoms(seed(selectionActionsAtom, []), seed(menuConfigAtom, layout([], []))),
  ],
};

/** No selection target: the cluster stays silent even with actions registered. */
export const NoSelectionInput: Story = {
  args: { input: null },
  decorators: [
    withAtoms(
      seed(selectionActionsAtom, actions),
      seed(menuConfigAtom, layout([], [])),
    ),
  ],
};
