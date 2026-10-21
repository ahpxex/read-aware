import { useState } from "react";
import { useAtomValue } from "jotai";
import { pluginSettingsPagesAtom, usePluginViewSource } from "../../plugins";

export function usePluginSettingsPage(pluginId: string) {
  const pages = useAtomValue(pluginSettingsPagesAtom);
  const page = pages.find((entry) => entry.pluginId === pluginId);
  const [failed, setFailed] = useState(false);
  const loaded = usePluginViewSource(
    page?.view,
    Boolean(page),
    () => {
      setFailed(false);
      return page!.view();
    },
    () => setFailed(true),
  );
  return { ...loaded, page, failed };
}
