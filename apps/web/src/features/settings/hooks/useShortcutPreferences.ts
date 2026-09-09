import { useCallback, useRef, useState } from "react";
import { useToast } from "@read-aware/ui";
import type { SettingChange } from "@read-aware/core";
import { createSettingsDomain } from "../../../domain/settings/domain";
import { describeError } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { shortcutSettingPath, shortcutTokens } from "../lib/shortcut-catalog";
import type { KeyChord, ShortcutId } from "../lib/shortcuts";

const settings = createSettingsDomain("user");
const log = createLogger("shortcut-settings");

/** The native editor submits intents, never a copy of the whole bindings map. */
export function useShortcutPreferences() {
  const { toast } = useToast();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const submit = useCallback(async (changes: () => Promise<SettingChange[]>): Promise<boolean> => {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    try {
      const batch = await changes();
      if (batch.length) await settings.commands.update(batch);
      return true;
    } catch (error) {
      log.warn("Shortcut change failed", error);
      toast({ variant: "destructive", description: describeError(error).body });
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }, [toast]);
  const rebind = useCallback((id: ShortcutId, chord: KeyChord) => submit(async () => [
    { path: shortcutSettingPath(id), value: shortcutTokens(chord) },
  ]), [submit]);
  const reset = useCallback((id: ShortcutId) => submit(async () => [
    { path: shortcutSettingPath(id), value: null },
  ]), [submit]);
  const resetAll = useCallback(() => submit(async () =>
    (await settings.queries.snapshot({ section: "shortcuts" })).settings
      .filter(setting => setting.shortcut?.overridden)
      .map(setting => ({ path: setting.path, value: null })),
  ), [submit]);
  return { busy, rebind, reset, resetAll };
}
