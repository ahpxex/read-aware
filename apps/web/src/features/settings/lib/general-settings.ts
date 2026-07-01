import { localKV } from "../../../platform/local-store";
import type { AppLocale } from "../../../i18n/config";

const STORAGE_KEY = "read-aware-general-settings";

/** What the app shows on launch. */
export type StartView = "shelf" | "resume";
/**
 * Interface language. `null` means "not yet chosen" — the boot sequence then
 * auto-detects from the OS/browser (see `detectInitialLocale`). A concrete
 * value is stored once the user picks one in Settings.
 */
export type AppLanguage = AppLocale | null;

export type GeneralSettings = {
  startView: StartView;
  language: AppLanguage;
  crashReports: boolean;
  /** Desktop-shell preferences — persisted here, applied by the Tauri shell. */
  launchAtStartup: boolean;
  fileAssociations: boolean;
  autoUpdate: boolean;
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  startView: "shelf",
  language: null,
  crashReports: false,
  launchAtStartup: false,
  fileAssociations: true,
  autoUpdate: true,
};

export function getGeneralSettings(): GeneralSettings {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_GENERAL_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<GeneralSettings>;
    return {
      startView: parsed.startView ?? DEFAULT_GENERAL_SETTINGS.startView,
      language: parsed.language ?? DEFAULT_GENERAL_SETTINGS.language,
      crashReports: parsed.crashReports ?? DEFAULT_GENERAL_SETTINGS.crashReports,
      launchAtStartup: parsed.launchAtStartup ?? DEFAULT_GENERAL_SETTINGS.launchAtStartup,
      fileAssociations: parsed.fileAssociations ?? DEFAULT_GENERAL_SETTINGS.fileAssociations,
      autoUpdate: parsed.autoUpdate ?? DEFAULT_GENERAL_SETTINGS.autoUpdate,
    };
  } catch {
    return DEFAULT_GENERAL_SETTINGS;
  }
}

export function saveGeneralSettings(settings: GeneralSettings): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(settings));
}
