import { atom } from "jotai";

export type SoftwareUpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "permission-required"
  | "installer-open"
  | "error";

export type SoftwareUpdateState = {
  phase: SoftwareUpdatePhase;
  currentVersion: string | null;
  availableVersion: string | null;
  progress: number | null;
  /** Which step failed; the raw error goes to the log, not into state. */
  errorStage: "check" | "install" | null;
};

export const softwareUpdateAtom = atom<SoftwareUpdateState>({
  phase: "idle",
  currentVersion: null,
  availableVersion: null,
  progress: null,
  errorStage: null,
});
