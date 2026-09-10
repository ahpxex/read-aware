import { atom } from "jotai";
import type { HostUpdatePhase, HostUpdateState } from "@read-aware/core";

export type SoftwareUpdatePhase = HostUpdatePhase;
export type SoftwareUpdateState = HostUpdateState;

export const softwareUpdateAtom = atom<SoftwareUpdateState>({
  phase: "idle",
  currentVersion: null,
  availableVersion: null,
  progress: null,
  errorStage: null,
});
