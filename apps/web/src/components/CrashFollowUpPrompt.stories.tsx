import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  GENERAL_SETTINGS_KEY,
  getGeneralSettings,
  saveGeneralSettings,
} from "../features/settings/lib/general-settings";
import { consumeCrashMarker, markCrash, type CrashKind } from "../platform/crash-marker";
import { localKV } from "../platform/local-store";
import { settingsOpenAtom, settingsSectionRequestAtom } from "../state/ui";
import { CrashFollowUpPrompt } from "./CrashFollowUpPrompt";

type NextLaunchProps = {
  /** How the previous run ended. */
  kind: CrashKind;
  /** The "offer a report after a crash" general setting. */
  crashPrompt: boolean;
};

/** Where the prompt's action sends the user, read back from the workspace atoms. */
function SettingsRequestReadout() {
  const open = useAtomValue(settingsOpenAtom);
  const section = useAtomValue(settingsSectionRequestAtom);
  return (
    <p className="text-caption text-fg-muted">
      Settings: {open ? `open, requested section "${section ?? "none"}"` : "closed"}
    </p>
  );
}

/**
 * The next launch after a crash, in the order the app sees it: the previous
 * run left its marker, then the prompt mounts and consumes it. The marker is
 * written in this effect (not before render) so a remount, such as a toolbar
 * change, replays the launch instead of finding the marker already consumed.
 *
 * The general setting lives in this Storybook origin's localStorage, which
 * the GeneralPanel stories also write; it is pinned here for the mount and
 * the previous record restored afterwards.
 */
function NextLaunch({ kind, crashPrompt }: NextLaunchProps) {
  const [launched, setLaunched] = useState(false);
  useEffect(() => {
    // Written only when it differs, so the stored record is untouched in the
    // common case and a reload mid-story can leave at most this one field.
    const previous = localKV.getItem(GENERAL_SETTINGS_KEY);
    const pinned = getGeneralSettings().crashPrompt !== crashPrompt;
    if (pinned) saveGeneralSettings({ ...getGeneralSettings(), crashPrompt });
    markCrash(kind);
    setLaunched(true);
    return () => {
      setLaunched(false);
      // A marker the prompt did not consume must not leak into the next story.
      consumeCrashMarker();
      if (!pinned) return;
      if (previous === null) localKV.removeItem(GENERAL_SETTINGS_KEY);
      else localKV.setItem(GENERAL_SETTINGS_KEY, previous);
    };
  }, [kind, crashPrompt]);
  return (
    <div className="space-y-2">
      <p className="text-sm text-fg">
        The previous run ended on the {kind === "boot" ? "boot-failure screen" : "root error boundary"}; the crash
        prompt setting is {crashPrompt ? "on" : "off"}.
      </p>
      <SettingsRequestReadout />
      {launched && <CrashFollowUpPrompt />}
    </div>
  );
}

/**
 * After a run that ended on the boot-failure screen or the root error
 * boundary, the next healthy launch offers, never sends, a diagnostics
 * report: a toast that waits for the user and deep-links into Settings →
 * About, where the existing preview-and-confirm flow takes over.
 *
 * The component itself renders nothing; the toast comes from the app's
 * ToastProvider, which the preview supplies.
 */
const meta = {
  title: "Interface/App/CrashFollowUpPrompt",
  component: NextLaunch,
  parameters: { layout: "padded" },
  args: { kind: "render", crashPrompt: true },
  argTypes: { kind: { control: "inline-radio", options: ["render", "boot"] } },
} satisfies Meta<typeof NextLaunch>;

export default meta;
type Story = StoryObj<typeof meta>;

/** After a render crash: the toast stays until the user acts on it or dismisses it. */
export const AfterRenderCrash: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(page.getByText("ReadAware had a problem last time")).toBeVisible());
    await expect(page.getByText("Sending a diagnostics report helps get it fixed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Review & send" })).toBeVisible();
  },
};

/**
 * "Review & send" sends nothing: it asks Settings to open on About, where the
 * diagnostics preview-and-confirm flow lives (the readout shows the request).
 */
export const ReviewAndSend: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole("button", { name: "Review & send" }));
    await waitFor(() => expect(page.getByText('Settings: open, requested section "about"')).toBeVisible());
  },
};

/** After a boot failure: the same offer; the prompt does not distinguish the two. */
export const AfterBootFailure: Story = {
  args: { kind: "boot" },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(page.getByText("ReadAware had a problem last time")).toBeVisible());
  },
};

/**
 * The setting turned off: the marker is still consumed, so the crash is not
 * offered on a later launch either, but no toast appears.
 */
export const PromptTurnedOff: Story = {
  args: { crashPrompt: false },
};
