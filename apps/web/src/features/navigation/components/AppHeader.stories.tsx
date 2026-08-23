import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowsClockwise, Export, Trash } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";
import { seed, withAtoms } from "../../../story-support/atoms";
import { SyncReauthNoticeView } from "../../sync/components/SyncReauthNoticeView";
import { headerActionsAtom } from "../../plugins/state/plugin-store";
import type { RegisteredHeaderAction } from "../../plugins/lib/plugin-types";
import type { HeaderActionEntry } from "../lib/header-actions";
import { AppHeader } from "./AppHeader";

const pluginActions: RegisteredHeaderAction[] = [
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
];

/** The Agent page replaces the utility cluster with conversation actions. */
const conversationActions: HeaderActionEntry[] = [
  {
    id: "new",
    inline: (
      <IconButton
        size="sm"
        label="New conversation"
        icon={<ArrowsClockwise size={16} weight="regular" aria-hidden="true" />}
      />
    ),
    overflow: { id: "new", label: "New conversation", run: () => {} },
  },
  {
    id: "export",
    inline: (
      <IconButton
        size="sm"
        label="Export conversation"
        icon={<Export size={16} weight="regular" aria-hidden="true" />}
      />
    ),
    overflow: { id: "export", label: "Export conversation", run: () => {} },
  },
  {
    id: "clear",
    inline: (
      <IconButton
        size="sm"
        label="Clear conversation"
        icon={<Trash size={16} weight="regular" aria-hidden="true" />}
      />
    ),
    overflow: { id: "clear", label: "Clear conversation", run: () => {} },
  },
];

/**
 * The app's single top bar: user-arranged primary destinations in the centre,
 * contextual and utility actions at the edges — never competing with the
 * navigation.
 *
 * The bar is also where platform differences land. On frameless Windows and
 * Linux the caption controls own the top-right corner, so the icon cluster
 * moves left; macOS mirrors the traffic lights instead. And as the window
 * narrows, utility actions collapse into the dots menu one at a time, so the
 * primary navigation is never the thing that gets squeezed — resize the
 * viewport on any story below to see it.
 */
const meta = {
  title: "Interface/Navigation/AppHeader",
  component: AppHeader,
  parameters: { layout: "fullscreen" },
  args: {
    activeTopNav: "shelf",
    isImporting: false,
    onImport: () => {},
    onOpenSettings: () => {},
    onOpenSearch: () => {},
    onTopNavChange: () => {},
  },
  decorators: [
    withAtoms(seed(headerActionsAtom, [])),
    (Story) => (
      <div className="min-h-64 bg-paper">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AppHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shelf, the app's default destination. */
export const Shelf: Story = {};

/** The Context (Agent) page. */
export const Context: Story = {
  args: { activeTopNav: "context" },
};

/** A plugin page, which occupies the top-nav state like any other destination. */
export const PluginPage: Story = {
  args: { activeTopNav: "plugin:vocab:notebook" },
  decorators: [withAtoms(seed(headerActionsAtom, pluginActions))],
};

/** The stats page, which is a destination like any other. */
export const Stats: Story = {
  args: { activeTopNav: "stats" },
};

/** An import running: the action reports it rather than going quiet. */
export const Importing: Story = {
  args: { isImporting: true },
};

/** With a contextual control in the cluster — the shelf's view menu. */
export const WithViewControl: Story = {
  args: {
    viewControl: (
      <IconButton
        size="sm"
        label="Shelf view"
        icon={<ArrowsClockwise size={16} weight="regular" aria-hidden="true" />}
      />
    ),
  },
};

/** A quiet status beside the window controls — here, the re-login notice. */
export const WithLeadingStatus: Story = {
  args: {
    leadingStatus: <SyncReauthNoticeView onOpenSettings={() => {}} onDismiss={() => {}} />,
  },
};

/** The Context page's own actions, which replace the utility cluster wholesale. */
export const WithConversationActions: Story = {
  args: { activeTopNav: "context", actions: conversationActions },
};

/** Plugin contributions in the header, alongside the core actions. */
export const WithPluginActions: Story = {
  decorators: [withAtoms(seed(headerActionsAtom, pluginActions))],
};

/** Everything at once — the bar's most crowded state. */
export const Crowded: Story = {
  args: {
    isImporting: true,
    leadingStatus: <SyncReauthNoticeView onOpenSettings={() => {}} onDismiss={() => {}} />,
    viewControl: (
      <IconButton
        size="sm"
        label="Shelf view"
        icon={<ArrowsClockwise size={16} weight="regular" aria-hidden="true" />}
      />
    ),
  },
  decorators: [withAtoms(seed(headerActionsAtom, pluginActions))],
};

/** A phone-width viewport, where the cluster collapses to one overflow menu. */
export const PhoneWidth: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  decorators: [
    (Story) => (
      <div className="w-[22rem] bg-paper">
        <Story />
      </div>
    ),
  ],
};
