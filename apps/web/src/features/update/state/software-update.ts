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
  error: string | null;
  errorStage: "check" | "install" | null;
};

export const softwareUpdateAtom = atom<SoftwareUpdateState>({
  phase: "idle",
  currentVersion: null,
  availableVersion: null,
  progress: null,
  error: null,
  errorStage: null,
});
