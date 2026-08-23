import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";
import { seed, withAtoms } from "../../../story-support/atoms";
import { SyncReauthNoticeView } from "../../sync/components/SyncReauthNoticeView";
import { headerActionsAtom } from "../../plugins/state/plugin-store";
import type { RegisteredHeaderAction } from "../../plugins/lib/plugin-types";
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

const viewControl = (
  <IconButton
    size="sm"
    label="Shelf view"
    icon={<ArrowsClockwise size={16} weight="regular" aria-hidden="true" />}
  />
);

/**
 * Stamps the shell attributes the desktop app sets on `<html>`.
 *
 * The 8.25rem reserved for the caption controls is CSS, keyed off
 * `data-tauri`/`data-os`. Passing `chrome` alone would move the cluster but
 * leave that inset at 0, so the bar would render an arrangement that never
 * actually ships. (The attribute value is `mac`, not `macos`; getting it wrong
 * renders exactly such a phantom.)
 */
const withShellAttrs = (os: "windows" | "linux"): Decorator =>
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
 * The top bar on the frameless Windows and Linux shells.
 *
 * These windows have no system title bar, so the app draws its own caption
 * controls — minimize / maximize / close — flush into the top-RIGHT corner.
 * That corner being spoken for is why the whole utility cluster moves to the
 * LEFT, beside the back affordance: the platform-native arrangement, and the
 * mirror image of macOS (which has its own group).
 *
 * The caption buttons are inert here — their handlers drive the real window
 * through Tauri, which Storybook cannot reach.
 */
const meta = {
  title: "Interface/Navigation/AppHeader/Windows & Linux",
  component: AppHeader,
  parameters: { layout: "fullscreen" },
  args: {
    chrome: "custom",
    activeTopNav: "shelf",
    isImporting: false,
    onImport: () => {},
    onOpenSettings: () => {},
    onOpenSearch: () => {},
    onTopNavChange: () => {},
  },
  decorators: [
    withShellAttrs("windows"),
    withAtoms(seed(headerActionsAtom, [])),
    (Story) => (
      <div className="min-h-64">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AppHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The cluster on the left, the caption controls owning the right. */
export const Windows: Story = {
  args: { viewControl },
};

/** Linux is the same arrangement — one undecorated GTK window. */
export const Linux: Story = {
  decorators: [withShellAttrs("linux")],
  args: { viewControl },
};

/** A full cluster on the left: the crowded case this layout has to survive. */
export const Crowded: Story = {
  args: {
    isImporting: true,
    viewControl,
    leadingStatus: <SyncReauthNoticeView onOpenSettings={() => {}} onDismiss={() => {}} />,
  },
  decorators: [withAtoms(seed(headerActionsAtom, pluginActions))],
};

/**
 * A narrow frameless window. The compact layout clears the caption controls
 * with an in-track spacer rather than the wide bar's trailing one, so the
 * centre stays centred — this is where that arithmetic shows.
 */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="w-[30rem]">
        <Story />
      </div>
    ),
  ],
};
