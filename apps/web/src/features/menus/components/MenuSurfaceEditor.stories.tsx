import type { Meta, StoryObj } from "@storybook/react-vite";
import { seed, withAtoms } from "../../../story-support/atoms";
import type { RegisteredHeaderAction, RegisteredSelectionAction } from "../../plugins/lib/plugin-types";
import { headerActionsAtom, selectionActionsAtom } from "../../plugins/state/plugin-store";
import { CORE_MENU_DEFAULTS, CORE_OVERFLOW_DEFAULTS, menuConfigAtom, pluginMenuId } from "../state/menu-config";
import type { MenuConfig, MenuSurface, SurfaceLayout } from "../state/menu-config";
import { MenuSurfaceEditor } from "./MenuSurfaceEditor";

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
    id: "feeds",
    title: "Feeds",
    icon: "rows",
    surface: "shelf",
    presentation: "popup",
    key: "rss:feeds",
    pluginId: "rss",
    pluginName: "RSS Reader",
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

const selectionActions: RegisteredSelectionAction[] = [
  {
    id: "lookup",
    title: "Look up",
    icon: "magnifying-glass",
    role: "lookup",
    key: "dictionary:lookup",
    pluginId: "dictionary",
    pluginName: "Dictionary",
    run: () => undefined,
  },
  {
    id: "translate",
    title: "Translate",
    icon: "translate",
    key: "dictionary:translate",
    pluginId: "dictionary",
    pluginName: "Dictionary",
    run: () => undefined,
  },
];

/** A config built from the app's own defaults, patched per story. */
function config(patch: Partial<Record<MenuSurface, SurfaceLayout>> = {}): MenuConfig {
  const surfaces: MenuSurface[] = ["primaryNav", "shelfHeader", "readerHeader", "selection"];
  return Object.fromEntries(
    surfaces.map((surface) => [
      surface,
      patch[surface] ?? {
        visible: [...CORE_MENU_DEFAULTS[surface]],
        overflow: [...CORE_OVERFLOW_DEFAULTS[surface]],
      },
    ]),
  ) as MenuConfig;
}

/** Seeds the layout plus the plugin contributions that appear as draggables. */
function layout(patch: Partial<Record<MenuSurface, SurfaceLayout>> = {}) {
  return withAtoms(
    seed(menuConfigAtom, config(patch)),
    seed(headerActionsAtom, headerActions),
    seed(selectionActionsAtom, selectionActions),
  );
}

/**
 * The drag-to-arrange editor for one surface, rendered as the real thing: the
 * live bar on top, the overflow panel opened beneath it, items dragging between
 * the two.
 *
 * Both the layout and the plugin contributions live in atoms, so the stories
 * seed them — otherwise the editor would show whatever this Storybook origin's
 * localStorage happens to hold, and no plugin rows at all.
 */
const meta = {
  title: "Interface/Menus/MenuSurfaceEditor",
  component: MenuSurfaceEditor,
  parameters: { layout: "padded" },
  args: { surface: "shelfHeader" },
  decorators: [
    layout(),
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MenuSurfaceEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shelf header on defaults, with two plugin pages available to place. */
export const ShelfHeader: Story = {};

/**
 * The primary navigation is a row of text destinations rather than icon
 * buttons, so the bar renders labels with slash separators and has no dots
 * trigger at all.
 */
export const PrimaryNav: Story = {
  args: { surface: "primaryNav" },
};

/** The reader header, whose plugin contributions are a different set. */
export const ReaderHeader: Story = {
  args: { surface: "readerHeader" },
};

/** The selection menu, the densest surface. */
export const Selection: Story = {
  args: { surface: "selection" },
};

/** Everything demoted: the bar is bare and the overflow carries the surface. */
export const AllOverflowed: Story = {
  decorators: [
    layout({
      shelfHeader: {
        visible: [],
        overflow: [
          ...CORE_MENU_DEFAULTS.shelfHeader,
          ...CORE_OVERFLOW_DEFAULTS.shelfHeader,
        ],
      },
    }),
  ],
};

/** Plugin items promoted into the bar, beside the core ones. */
export const WithPluginItemsPinned: Story = {
  decorators: [
    layout({
      shelfHeader: {
        visible: [
          ...CORE_MENU_DEFAULTS.shelfHeader,
          pluginMenuId("vocab:notebook"),
          pluginMenuId("rss:feeds"),
        ],
        overflow: [...CORE_OVERFLOW_DEFAULTS.shelfHeader],
      },
    }),
  ],
};

/**
 * The primary nav at its cap (four visible). It also has a floor of one — it
 * is the only way between Library and Agent — so the last item cannot be
 * dragged out.
 */
export const PrimaryNavAtCap: Story = {
  args: { surface: "primaryNav" },
  decorators: [
    layout({
      primaryNav: {
        visible: [
          "core:library",
          "core:agent",
          "core:stats",
          pluginMenuId("vocab:notebook"),
        ],
        overflow: [],
      },
    }),
  ],
};

/** No plugins installed: only the core items are arrangeable. */
export const WithoutPlugins: Story = {
  decorators: [
    withAtoms(
      seed(menuConfigAtom, config()),
      seed(headerActionsAtom, []),
      seed(selectionActionsAtom, []),
    ),
  ],
};
