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
  /**
   * Offer (ask, never auto-send) a diagnostics report after a crash.
   * Fresh field name on purpose: the retired `crashReports` toggle was wired
   * to nothing, so its persisted value carries no user intent and is ignored.
   */
  crashPrompt: boolean;
  /** Desktop-shell preferences — persisted here, applied by the Tauri shell. */
  launchAtStartup: boolean;
  fileAssociations: boolean;
  autoUpdate: boolean;
  /** Show the post-upgrade "what's new" dialog once per version change. */
  whatsNewDialog: boolean;
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  startView: "shelf",
  language: null,
  crashPrompt: true,
  launchAtStartup: false,
  fileAssociations: true,
  autoUpdate: true,
  whatsNewDialog: true,
};

export function getGeneralSettings(): GeneralSettings {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_GENERAL_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<GeneralSettings>;
    return {
      startView: parsed.startView ?? DEFAULT_GENERAL_SETTINGS.startView,
      language: parsed.language ?? DEFAULT_GENERAL_SETTINGS.language,
      crashPrompt: parsed.crashPrompt ?? DEFAULT_GENERAL_SETTINGS.crashPrompt,
      launchAtStartup: parsed.launchAtStartup ?? DEFAULT_GENERAL_SETTINGS.launchAtStartup,
      fileAssociations: parsed.fileAssociations ?? DEFAULT_GENERAL_SETTINGS.fileAssociations,
      autoUpdate: parsed.autoUpdate ?? DEFAULT_GENERAL_SETTINGS.autoUpdate,
      whatsNewDialog: parsed.whatsNewDialog ?? DEFAULT_GENERAL_SETTINGS.whatsNewDialog,
    };
  } catch {
    return DEFAULT_GENERAL_SETTINGS;
  }
}

export function saveGeneralSettings(settings: GeneralSettings): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(settings));
}
