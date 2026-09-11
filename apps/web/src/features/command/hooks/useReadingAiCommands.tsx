import { useTranslation } from "../../../i18n";
import { useMemo } from "react";
import { useReadingAiControls } from "../../ai/hooks/useReadingAiControls";
import { READING_AI_ICONS } from "../../ai/lib/reading-ai-icons";
import type { CommandItem } from "../lib/build-commands";

export function useReadingAiCommands(active: boolean): CommandItem[] {
  const controls = useReadingAiControls(active), { t } = useTranslation("settings");
  return useMemo(() => controls.actions.map(action => {
    const Icon = READING_AI_ICONS[action];
    return { id: `reading-ai:${action}`, kind: "action", group: "goto", title: t(`ai.featureList.${action}.label`),
      icon: <Icon size={16} weight="regular" aria-hidden="true" />, disabled: controls.disabled(action),
      perform: (signal?: AbortSignal) => controls.run(action, signal) } satisfies CommandItem;
  }), [controls, t]);
}
