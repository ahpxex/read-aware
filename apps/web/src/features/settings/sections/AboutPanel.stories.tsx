import type { Meta, StoryObj } from "@storybook/react-vite";
import { seed, withAtoms } from "../../../story-support/atoms";
import type { SoftwareUpdateState } from "../../update/state/software-update";
import { softwareUpdateAtom } from "../../update/state/software-update";
import { AboutPanel } from "./AboutPanel";

const base: SoftwareUpdateState = {
  phase: "idle",
  currentVersion: "0.5.2",
  availableVersion: null,
  progress: null,
  errorStage: null,
};

const updateState = (patch: Partial<SoftwareUpdateState>) =>
  withAtoms(seed(softwareUpdateAtom, { ...base, ...patch }));

/**
 * Settings → About: version and build, the update channel, the check/install
 * control, and the diagnostics group.
 *
 * The version line pairs the number with its minor series' codename when it
 * has one. Update state lives in an atom, so the stories seed it; the build
 * label is derived from the running platform, which in Storybook is the web
 * shell.
 */
const meta = {
  title: "Interface/Settings/AboutPanel",
  component: AboutPanel,
  parameters: { layout: "fullscreen" },
  decorators: [updateState({})],
} satisfies Meta<typeof AboutPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At rest, before any check has run. */
export const Idle: Story = {};

/** A check in flight. */
export const Checking: Story = {
  decorators: [updateState({ phase: "checking" })],
};

/** Already current — the check ran and found nothing. */
export const UpToDate: Story = {
  decorators: [updateState({ phase: "up-to-date" })],
};

/** An update is available to install. */
export const UpdateAvailable: Story = {
  decorators: [updateState({ phase: "available", availableVersion: "0.6.0" })],
};

/** Downloading, with progress. */
export const Downloading: Story = {
  decorators: [
    updateState({ phase: "downloading", availableVersion: "0.6.0", progress: 63 }),
  ],
};

/** Installing. */
export const Installing: Story = {
  decorators: [updateState({ phase: "installing", availableVersion: "0.6.0" })],
};

/** A failed check, which surfaces here even though the header stays silent. */
export const CheckFailed: Story = {
  decorators: [
    updateState({ phase: "error", errorStage: "check" }),
  ],
};

/** A version with no codename in the registry — the number stands alone. */
export const VersionWithoutCodename: Story = {
  decorators: [updateState({ currentVersion: "0.5.2-rc.1" })],
};

/** No version could be read (the web shell) — the unknown label stands in. */
export const UnknownVersion: Story = {
  decorators: [updateState({ currentVersion: null })],
};
