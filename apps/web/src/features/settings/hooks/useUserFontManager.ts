import { useCallback, useState } from "react";
import { useAtomValue } from "jotai";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { describeError } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import type { UserFontEntry } from "../../../domain/fonts";
import { importUserFonts, removeUserFont, userFontsAtom } from "../lib/user-fonts";
import { canImportFonts, pickFontFiles } from "../lib/pick-font-file";

const log = createLogger("user-font-manager");

/**
 * The import/remove orchestration behind the font pickers' imported-fonts
 * section: opens the platform picker, stages + commits each pick (the event
 * projects the registry row and readies its blob for sync), and removes a
 * font after its confirmation dialog. Errors surface as destructive toasts
 * through `describeError` — raw native errors stay in the log.
 */
export function useUserFontManager() {
  const { t } = useTranslation(["settings", "common"]);
  const toast = useToast();
  const userFonts = useAtomValue(userFontsAtom);
  const [importing, setImporting] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<UserFontEntry | null>(null);
  const [removing, setRemoving] = useState(false);

  const importFonts = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      const picks = await pickFontFiles(t);
      if (picks.length === 0) return;
      await importUserFonts(picks);
    } catch (error) {
      log.warn("Font import failed", error);
      const described = describeError(error, { fallback: t("settings:font.importFailed") });
      toast.toast({ description: described.body, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }, [importing, t, toast]);

  const confirmRemoval = useCallback(async () => {
    const font = pendingRemoval;
    if (!font || removing) return;
    setRemoving(true);
    try {
      await removeUserFont(font);
      setPendingRemoval(null);
    } catch (error) {
      log.warn(`Removing font ${font.id} failed`, error);
      const described = describeError(error, { fallback: t("settings:font.removeFailed") });
      toast.toast({ description: described.body, variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  }, [pendingRemoval, removing, t, toast]);

  return {
    /** Whether this shell can pick files (native staging exists). */
    canImport: canImportFonts(),
    userFonts,
    importing,
    importFonts,
    /** The font awaiting its removal confirmation (null = dialog closed). */
    pendingRemoval,
    askRemoval: setPendingRemoval,
    cancelRemoval: () => setPendingRemoval(null),
    removing,
    confirmRemoval,
  };
}
