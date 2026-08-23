import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScrollArea } from "@read-aware/ui";
import { seed, withAtoms } from "../../../story-support/atoms";
import type { PluginView, RegisteredHeaderAction } from "../lib/plugin-types";
import { headerActionsAtom } from "../state/plugin-store";
import { PLUGIN_NAV_PREFIX, PluginPageHost } from "./PluginPageHost";
import { everyBlockKind } from "./plugin.fixtures";

function pageAction(
  id: string,
  title: string,
  view: () => PluginView | Promise<PluginView>,
  pluginName = "Vocabulary",
): RegisteredHeaderAction {
  return {
    id,
    title,
    icon: "notebook",
    surface: "shelf",
    presentation: "page",
    key: `vocab:${id}`,
    pluginId: "vocab",
    pluginName,
    view,
  };
}

const listView: PluginView = {
  kind: "list",
  title: "Saved words",
  searchable: true,
  items: Array.from({ length: 40 }, (_, i) => ({
    id: `w${i}`,
    title: `Entry ${i + 1}`,
    subtitle: "Saved from Pale Fire",
    accessories: [{ kind: "text", text: `${(i % 9) + 1}×` }],
  })),
};

/** Seeds one registered page action and points the host at it. */
const registered = (action: RegisteredHeaderAction) =>
  withAtoms(seed(headerActionsAtom, [action]));

/**
 * The full-page container for a shelf action registered with
 * `presentation: "page"` — the plugin analogue of the Stats surface.
 *
 * A page scrolls as a page: the content flows in the app's scroll viewport, so
 * these stories supply one, and windowed lists virtualize against it. When the
 * plugin vanishes (disabled or uninstalled) the host calls `onExit` and renders
 * nothing, which is the "ActionMissing" story.
 */
const meta = {
  title: "Interface/Plugins/PluginPageHost",
  component: PluginPageHost,
  parameters: { layout: "fullscreen" },
  args: { navKey: `${PLUGIN_NAV_PREFIX}vocab:notebook`, onExit: () => {} },
  decorators: [
    (Story) => (
      <ScrollArea className="h-[36rem] w-full">
        <Story />
      </ScrollArea>
    ),
  ],
} satisfies Meta<typeof PluginPageHost>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A list page: the plugin name sits under the title as provenance. */
export const ListPage: Story = {
  decorators: [registered(pageAction("notebook", "Saved words", () => listView))],
};

/**
 * When the action's title and the plugin's name are the same, the subtitle is
 * dropped rather than repeating itself.
 */
export const TitleMatchesPluginName: Story = {
  decorators: [
    registered(pageAction("notebook", "Vocabulary", () => listView, "Vocabulary")),
  ],
};

/** A detail page built from the block vocabulary. */
export const DetailPage: Story = {
  decorators: [
    registered(
      pageAction("about", "About this plugin", () => ({
        kind: "detail",
        title: "About",
        content: everyBlockKind,
      })),
    ),
  ],
};

/** A settings-shaped form page that writes through on each change. */
export const FormPage: Story = {
  decorators: [
    registered(
      pageAction("settings", "Preferences", () => ({
        kind: "form",
        submitMode: "change",
        fields: [
          { kind: "toggle", id: "auto", label: "Save words automatically", value: true },
          { kind: "number", id: "perPage", label: "Entries per page", value: 25 },
        ],
        onSubmit: () => undefined,
      })),
    ),
  ],
};

/** The view is still resolving: the page frame is up, the body not yet. */
export const AwaitingView: Story = {
  decorators: [
    registered(pageAction("slow", "Loading page", () => new Promise<PluginView>(() => {}))),
  ],
};

/**
 * The plugin was disabled or uninstalled while its page was open. The host
 * exits to the shelf and renders nothing rather than a dead frame.
 */
export const ActionMissing: Story = {
  decorators: [withAtoms(seed(headerActionsAtom, []))],
};
