import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { useToast } from "@read-aware/ui";
import { AppError } from "@read-aware/core";
import { createSettingsDomain } from "../../../domain/settings/domain";
import { generalSettingsAtom } from "../../../state/ui";
import { describeError } from "../../../i18n/describe-error";
import { desktopStartup } from "../../../platform/desktop-startup";
import { onLocalKVCommit } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import { GENERAL_SETTINGS_KEY, type GeneralSettings } from "../lib/general-settings";

type StartupState = { status: "loading" } | { status: "ready"; enabled: boolean } | { status: "failed"; error: unknown };
const domain = createSettingsDomain("user");
const log = createLogger("general-settings");

export function useGeneralSettings() {
  const settings = useAtomValue(generalSettingsAtom);
  const { toast } = useToast();
  const [startup, setStartup] = useState<StartupState>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    const owner = new AbortController();
    lifetime.current = owner;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      setStartup({ status: "loading" });
      try {
        if (!desktopStartup.supported()) throw new AppError("ui/unavailable", "Startup registration requires desktop");
        const result = await domain.queries.read("general.launchAtStartup");
        if (!owner.signal.aborted && current === request) setStartup({ status: "ready", enabled: result.value === true });
      } catch (error) {
        if (owner.signal.aborted || current !== request) return;
        log.error("Reading startup registration failed", error);
        setStartup({ status: "failed", error });
      }
    };
    const onFocus = () => { void refresh(); };
    const unsubscribe = onLocalKVCommit(commit => {
      if (commit.entries.some(entry => entry.key === GENERAL_SETTINGS_KEY)) void refresh();
    });
    window.addEventListener("focus", onFocus);
    void refresh();
    return () => { owner.abort(); unsubscribe(); window.removeEventListener("focus", onFocus); };
  }, [revision]);

  const update = async <K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) => {
    const owner = lifetime.current;
    if (active.current || !owner || owner.signal.aborted) return;
    active.current = true;
    setBusy(true);
    try {
      await domain.commands.update([{ path: `general.${key}`, value }], owner.signal);
    } catch (error) {
      log.error(`Saving general setting ${key} failed`, error);
      if (!owner.signal.aborted) {
        const failure = describeError(error);
        toast({ variant: "destructive", description: failure.body });
      }
    } finally {
      active.current = false;
      if (!owner.signal.aborted) { setBusy(false); setRevision(value => value + 1); }
    }
  };
  return { settings, startup, busy, update, retry: () => { if (!active.current) setRevision(value => value + 1); } };
}
