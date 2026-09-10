import { AppError } from "./errors";

export type HostWindowState = { minimized: boolean; maximized: boolean; fullscreen: boolean; focused: boolean };
export type HostWindowSnapshot =
  | { supported: false; revision: number }
  | ({ supported: true; revision: number } & HostWindowState);
export type HostWindowRequest =
  | { action: "minimize" | "maximize" | "restore" }
  | { action: "fullscreen"; enabled: boolean };
export type HostWindowReceipt = { status: "requested"; snapshot: HostWindowSnapshot };
export type HostWindowObservation =
  | { status: "ready"; snapshot: HostWindowSnapshot }
  | { status: "error"; code: string };
export interface HostWindowPort {
  snapshot(signal?: AbortSignal): Promise<HostWindowSnapshot>;
  control(request: HostWindowRequest, signal?: AbortSignal): Promise<HostWindowReceipt>;
}

export function normalizeHostWindowRequest(input: HostWindowRequest): HostWindowRequest {
  const fail = (): never => { throw new AppError("ui/invalid-target", "Invalid main-window intent"); };
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  if (input.action === "fullscreen") {
    if (typeof input.enabled !== "boolean" || Object.keys(input).some(key => key !== "action" && key !== "enabled")) return fail();
    return { action: "fullscreen", enabled: input.enabled };
  }
  if (!["minimize", "maximize", "restore"].includes(input.action) || Object.keys(input).some(key => key !== "action")) return fail();
  return { action: input.action };
}
