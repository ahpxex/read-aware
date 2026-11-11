/**
 * What kind of panel this device draws on — today, whether it is e-ink.
 *
 * Android exposes no "this is an e-paper display" API, so the native side
 * reports the device's build identity and the e-paper markers its system
 * properties carry, and `classifyEinkPanel` decides. The answer only seeds
 * the `auto` e-ink preference (`app-settings.ts`); the user's explicit
 * choice always wins, so a miss or a false positive is one toggle away.
 *
 * Read once at boot, before the theme is stamped: the panel never changes
 * while the app runs.
 */
import { invoke } from "./ipc";
import { isAndroid, isTauri } from "./environment";
import { createLogger } from "./logger";

const log = createLogger("display-profile");

/** The native `display_profile` command's report (Android only). */
export type DisplayProfileReport = {
  manufacturer: string;
  brand: string;
  model: string;
  device: string;
  /** Names of system properties that only e-paper display stacks define. */
  epdProperties: string[];
};

/**
 * Manufacturers that ship only e-paper Android devices, lower-cased as
 * `Build.MANUFACTURER` / `Build.BRAND` report them. A vendor that also sells
 * LCD devices does not belong here; it needs a model-level rule instead.
 */
const EINK_ONLY_VENDORS: readonly string[] = [
  "onyx", // BOOX
  "ireader", // 掌阅
  "boyue", // Likebook / Meebook
  "bigme",
  "hanvon", // 汉王
  "pocketbook",
  "moaan", // 墨案
  "dasung",
];

export function classifyEinkPanel(report: DisplayProfileReport): boolean {
  if (report.epdProperties.length > 0) return true;
  const vendors = [report.manufacturer, report.brand].map((value) => value.trim().toLowerCase());
  return vendors.some((vendor) => EINK_ONLY_VENDORS.includes(vendor));
}

let detected = false;

/** Whether boot detected an e-ink panel. False until `hydrateDisplayProfile` ran. */
export function einkPanelDetected(): boolean {
  return detected;
}

/**
 * Detect the panel once. A failed probe logs and reads as "not e-ink": the
 * e-ink mode toggle stays available, so nothing is lost but the default.
 */
export async function hydrateDisplayProfile(): Promise<void> {
  if (!isTauri() || !isAndroid()) return;
  try {
    const report = await invoke<DisplayProfileReport>("display_profile");
    detected = classifyEinkPanel(report);
    log.info(`display profile: ${report.manufacturer}/${report.brand} ${report.model} → e-ink ${detected}`);
  } catch (error) {
    log.warn("display profile probe failed; e-ink mode will not be enabled automatically", error);
  }
}
