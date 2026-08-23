import type { Meta, StoryObj } from "@storybook/react-vite";
import { seed, withAtoms } from "../../../story-support/atoms";
import type { SoftwareUpdateState } from "../state/software-update";
import { softwareUpdateAtom } from "../state/software-update";
import { UpdateIndicator } from "./UpdateIndicator";

const base: SoftwareUpdateState = {
  phase: "idle",
  currentVersion: "0.5.2",
  availableVersion: null,
  progress: null,
  error: null,
  errorStage: null,
};

/** Seeds the update state the indicator reads. */
const updateState = (patch: Partial<SoftwareUpdateState>) =>
  withAtoms(seed(softwareUpdateAtom, { ...base, ...patch }));

/**
 * The header's update chip.
 *
 * It is deliberately absent most of the time: idle, checking and up-to-date all
 * render nothing, because an update surface that is always present is just
 * noise. Only a ready, running, or failed *install* earns a line — and the
 * failed-check case stays silent too, since a failed check is not the user's
 * problem to act on.
 */
const meta = {
  title: "Interface/Update/UpdateIndicator",
  component: UpdateIndicator,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex w-[26rem] items-center rounded-md border border-border bg-surface px-3 py-2">
        <Story />
        <span className="ml-auto text-sm text-fg-subtle">Library</span>
      </div>
    ),
  ],
} satisfies Meta<typeof UpdateIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An update is ready to install; the version rides in the tooltip. */
export const Available: Story = {
  decorators: [updateState({ phase: "available", availableVersion: "0.6.0" })],
};

/** Downloading, with a percentage. */
export const Downloading: Story = {
  decorators: [
    updateState({ phase: "downloading", availableVersion: "0.6.0", progress: 42 }),
  ],
};

/** Downloading before any progress has been reported — no invented number. */
export const DownloadingWithoutProgress: Story = {
  decorators: [updateState({ phase: "downloading", availableVersion: "0.6.0" })],
};

/** Installing: the action is disabled but the chip stays legible. */
export const Installing: Story = {
  decorators: [updateState({ phase: "installing", availableVersion: "0.6.0" })],
};

/** Android's permission gate, which still reads as "ready to install". */
export const PermissionRequired: Story = {
  decorators: [
    updateState({ phase: "permission-required", availableVersion: "0.6.0" }),
  ],
};

/** The OS installer is open; the app is waiting on it. */
export const InstallerOpen: Story = {
  decorators: [updateState({ phase: "installer-open", availableVersion: "0.6.0" })],
};

/** An install that failed. Clicking re-checks rather than blindly retrying. */
export const InstallFailed: Story = {
  decorators: [
    updateState({
      phase: "error",
      errorStage: "install",
      error: "Could not replace the app bundle: permission denied",
      availableVersion: "0.6.0",
    }),
  ],
};

/** Idle: nothing rendered at all. */
export const IdleIsSilent: Story = {
  decorators: [updateState({ phase: "idle" })],
};

/** Checking is background work, so it says nothing. */
export const CheckingIsSilent: Story = {
  decorators: [updateState({ phase: "checking" })],
};

/** Up to date is not news either. */
export const UpToDateIsSilent: Story = {
  decorators: [updateState({ phase: "up-to-date" })],
};

/**
 * A failed *check* stays silent — unlike a failed install, there is nothing
 * for the reader to act on.
 */
export const CheckFailureIsSilent: Story = {
  decorators: [
    updateState({ phase: "error", errorStage: "check", error: "Network unreachable" }),
  ],
};
