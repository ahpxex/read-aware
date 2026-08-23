import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
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
 * Stamps the shell attributes the desktop app sets on `<html>`.
 *
 * The window-chrome clearances are CSS, keyed off `data-tauri`/`data-os` — the
 * 8.25rem reserved for self-drawn caption controls, the macOS traffic-light
 * inset. Passing `chrome` alone would move the cluster but leave those insets
 * at 0, so the bar would render a arrangement that never actually ships.
 */
// The values are the app's own (environment.ts writes `mac`, not `macos`) —
// the CSS keys off these exact strings.
const withShellAttrs = (os: "mac" | "windows" | "linux"): Decorator =>
  function ShellAttrs(Story) {
    useEffect(() => {
      const html = document.documentElement;
      const prevOs = html.getAttribute("data-os");
      const prevTauri = html.getAttribute("data-tauri");
      html.setAttribute("data-os", os);
      html.setAttribute("data-tauri", "true");
      return () => {
        if (prevOs === null) html.removeAttribute("data-os");
        else html.setAttribute("data-os", prevOs);
        if (prevTauri === null) html.removeAttribute("data-tauri");
        else html.setAttribute("data-tauri", prevTauri);
      };
    }, []);
    return <Story />;
  };

/**
 * The app's single top bar: user-arranged primary destinations in the centre,
 * contextual and utility actions at the edges — never competing with the
 * navigation.
 *
 * The bar is also where platform differences land, and each platform gets its
 * own story below. On frameless Windows and Linux the app draws its own
 * caption controls, which own the top-right corner — so the whole utility
 * cluster moves to the LEFT, the platform-native arrangement. macOS keeps the
 * cluster on the right, mirroring the native traffic lights on the other side.
 * The browser build has neither and reserves nothing.
 *
 * As the window narrows, utility actions collapse into the dots menu one at a
 * time, so the primary navigation is never the thing that gets squeezed —
 * resize the viewport on any story to see it.
 *
 * The caption buttons here are inert: their click handlers drive the real
 * window through Tauri, which Storybook has no access to.
 * `WindowCaptionControls` has its own stories for the buttons themselves.
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
      <div className="min-h-64 bg-[var(--ra-main-surface-color)]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AppHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shelf, the app's default destination, as the browser build draws it. */
export const Shelf: Story = {};

// ── Window chrome, per platform ─────────────────────────────────────────────

/**
 * Frameless Windows: the app draws minimize / maximize / close itself, flush
 * into the top-right corner. The utility cluster therefore sits on the LEFT,
 * beside the back affordance, and 8.25rem is reserved on the right so nothing
 * slides under the buttons.
 */
export const WindowsChrome: Story = {
  args: {
    chrome: "custom",
    viewControl: (
      <IconButton
        size="sm"
        label="Shelf view"
        icon={<ArrowsClockwise size={16} weight="regular" aria-hidden="true" />}
      />
    ),
  },
  decorators: [withShellAttrs("windows")],
};

/** Linux is the same frameless arrangement — one undecorated GTK window. */
export const LinuxChrome: Story = {
  args: { chrome: "custom" },
  decorators: [withShellAttrs("linux")],
};

/**
 * macOS: the native traffic lights overlay the header's left, so the bar
 * reserves an inset there and keeps its own cluster on the right.
 */
export const MacChrome: Story = {
  args: {
    chrome: "mac",
    viewControl: (
      <IconButton
        size="sm"
        label="Shelf view"
        icon={<ArrowsClockwise size={16} weight="regular" aria-hidden="true" />}
      />
    ),
  },
  decorators: [withShellAttrs("mac")],
};

/** Windows chrome carrying a full cluster — the crowded left-hand case. */
export const WindowsChromeCrowded: Story = {
  args: {
    chrome: "custom",
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
  decorators: [withShellAttrs("windows"), withAtoms(seed(headerActionsAtom, pluginActions))],
};

/**
 * A narrow frameless window. The compact layout uses an in-track spacer for
 * the caption controls rather than the wide bar's, so the centre stays
 * centred — this is where that arithmetic shows.
 */
export const WindowsChromeNarrow: Story = {
  args: { chrome: "custom" },
  decorators: [
    withShellAttrs("windows"),
    (Story) => (
      <div className="w-[30rem] bg-[var(--ra-main-surface-color)]">
        <Story />
      </div>
    ),
  ],
};

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
      <div className="w-[22rem] bg-[var(--ra-main-surface-color)]">
        <Story />
      </div>
    ),
  ],
};
