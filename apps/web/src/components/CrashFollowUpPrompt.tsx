/**
 * Mounted once inside the ToastProvider tree. If the previous run ended on
 * the boot-failure screen or the root error boundary (see
 * platform/crash-marker), this offers — asks, never sends — a diagnostics
 * report on the next healthy launch, deep-linking into the existing
 * preview-and-confirm flow (Settings → About → Diagnostics). Gated by the
 * "crash prompt" general setting.
 */
import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../i18n";
import { consumeCrashMarker } from "../platform/crash-marker";
import { getGeneralSettings } from "../features/settings/lib/general-settings";
import { settingsOpenAtom, settingsSectionRequestAtom } from "../state/ui";

export function CrashFollowUpPrompt() {
  const { toast } = useToast();
  const { t } = useTranslation("common");
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  const setSettingsSection = useSetAtom(settingsSectionRequestAtom);

  useEffect(() => {
    const marker = consumeCrashMarker();
    if (!marker || !getGeneralSettings().crashPrompt) return;
    toast({
      title: t("crashPrompt.title"),
      description: t("crashPrompt.body"),
      // A crash follow-up should wait for the user, not race a 6s timer.
      duration: 0,
      action: {
        label: t("crashPrompt.action"),
        onClick: () => {
          setSettingsSection("about");
          setSettingsOpen(true);
        },
      },
    });
  }, [toast, t, setSettingsOpen, setSettingsSection]);

  return null;
}
