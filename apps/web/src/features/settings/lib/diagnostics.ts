/**
 * The diagnostics bundle: everything a "the app broke" conversation needs,
 * assembled on demand — app/platform facts, the tail of the file log
 * (apps/desktop tauri-plugin-log), and the event-log integrity self-check
 * (`verify_projections`). The bundle leaves the device only when the user
 * exports it to a file or sends it to the relay's /v1/report endpoint, always
 * behind an explicit preview-and-confirm; nothing here runs automatically.
 *
 * Log messages are already user-content-free by the logger seam's rules, and
 * the self-check reports row COUNTS plus event type/id samples — so the
 * bundle stays safe to share by construction.
 */
import { invoke } from "@tauri-apps/api/core";
import { readCurrentAppVersion } from "../../update/lib/software-update";
import {
  isAndroid,
  isIOS,
  isMacOS,
  isTauri,
  isWindows,
} from "../../../platform/environment";
import { exportTextFile } from "../../../platform/export-file";
import { appHttpFetch } from "../../../platform/http-client";
import { relayBaseUrl } from "../../../platform/sync/sync-scheduler";

type LogFileTail = {
  name: string;
  modifiedMs: number;
  text: string;
  truncated: boolean;
};

type VerifyReport = {
  consistent: boolean;
  eventsReplayed: number;
  drift: { table: string; onlyLive: number; onlyReplayed: number; samples: string[] }[];
};

export type DiagnosticsBundle = {
  generatedAt: string;
  appVersion: string | null;
  platform: string;
  userAgent: string;
  language: string;
  logs: LogFileTail[] | { unavailable: string };
  /** The event-log ⇄ projection self-check; its failure is itself a finding. */
  projections: VerifyReport | { unavailable: string };
};

export function platformName(): string {
  if (!isTauri()) return "web";
  if (isAndroid()) return "android";
  if (isIOS()) return "ios";
  if (isMacOS()) return "macos";
  if (isWindows()) return "windows";
  return "linux";
}

function describeFailure(error: unknown): { unavailable: string } {
  return { unavailable: error instanceof Error ? error.message : String(error) };
}

export async function assembleDiagnosticsBundle(): Promise<DiagnosticsBundle> {
  const [logs, projections] = isTauri()
    ? await Promise.all([
        invoke<LogFileTail[]>("diagnostics_read_logs").catch(describeFailure),
        invoke<VerifyReport>("verify_projections").catch(describeFailure),
      ])
    : [
        { unavailable: "log files exist only in the desktop/mobile app" },
        { unavailable: "storage self-check exists only in the desktop/mobile app" },
      ];

  return {
    generatedAt: new Date().toISOString(),
    appVersion: await readCurrentAppVersion(),
    platform: platformName(),
    userAgent: navigator.userAgent,
    language: navigator.language,
    logs,
    projections,
  };
}

export async function exportDiagnosticsBundle(bundle: DiagnosticsBundle): Promise<boolean> {
  const stamp = bundle.generatedAt.slice(0, 10);
  return exportTextFile({
    filename: `readaware-diagnostics-${stamp}.json`,
    content: JSON.stringify(bundle, null, 2),
    mimeType: "application/json",
  });
}

/**
 * POST the bundle to the relay. Returns the receipt id the user can quote
 * when they get in touch. Native transport inside Tauri (no webview CORS);
 * plain fetch keeps the dev/browser build working against a local relay.
 */
export async function sendDiagnosticsReport(bundle: DiagnosticsBundle): Promise<string> {
  const doFetch = isTauri() ? appHttpFetch : fetch;
  const response = await doFetch(`${relayBaseUrl()}/v1/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      appVersion: bundle.appVersion ?? "unknown",
      platform: bundle.platform,
      bundle,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`report upload failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const { reportId } = (await response.json()) as { reportId: string };
  return reportId;
}

/** Where the log files live, for the settings row's reveal action. */
export async function diagnosticsLogDir(): Promise<string> {
  return invoke<string>("diagnostics_log_dir");
}
