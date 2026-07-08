import { useAtom } from "jotai";
import { Button, Toggle } from "@read-aware/ui";
import { aiPreferencesAtom } from "../../../state/ui";
import { useTranslation } from "../../../i18n";
import { AIConfigPanel } from "../components/AIConfigPanel";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { PendingBadge } from "../components/PendingBadge";
import { AI_FEATURE_KEYS } from "../lib/ai-preferences";

export function AIPanel() {
  const { t } = useTranslation("settings");
  const [prefs, setPrefs] = useAtom(aiPreferencesAtom);

  return (
    <SettingsPage
      title={t("ai.title")}
      description={t("ai.description")}
    >
      <SettingsGroup title={t("ai.connection")}>
        <AIConfigPanel />
      </SettingsGroup>

      <SettingsGroup
        title={t("ai.features.title")}
        description={t("ai.features.description")}
      >
        {AI_FEATURE_KEYS.map((key, index) => {
          const label = t(`ai.featureList.${key}.label`);
          return (
            <SettingsRow
              key={key}
              borderless={index === 0}
              title={label}
              description={t(`ai.featureList.${key}.description`)}
              control={
                <Toggle
                  aria-label={label}
                  checked={prefs.features[key]}
                  onChange={(enabled) =>
                    setPrefs({
                      ...prefs,
                      features: { ...prefs.features, [key]: enabled },
                    })
                  }
                />
              }
            />
          );
        })}
      </SettingsGroup>

      <SettingsGroup title={t("ai.chat")}>
        <SettingsRow
          borderless
          title={t("ai.followStreaming.title")}
          description={t("ai.followStreaming.description")}
          control={
            <Toggle
              aria-label={t("ai.followStreaming.title")}
              checked={prefs.followStreaming}
              onChange={(followStreaming) => setPrefs({ ...prefs, followStreaming })}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("ai.memory")}>
        <SettingsRow
          borderless
          title={t("ai.buildMemory.title")}
          description={t("ai.buildMemory.description")}
          control={
            <Toggle
              aria-label={t("ai.buildMemory.title")}
              checked={prefs.buildMemory}
              onChange={(buildMemory) => setPrefs({ ...prefs, buildMemory })}
            />
          }
        />
        <SettingsRow
          title={t("ai.storedMemory.title")}
          description={t("ai.storedMemory.description")}
          control={
            <span className="flex items-center gap-2">
              <PendingBadge />
              <Button variant="outline" size="sm" disabled>
                {t("ai.clearMemory")}
              </Button>
            </span>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("ai.privacy.title")}
        description={t("ai.privacy.description")}
      >
        <SettingsRow
          borderless
          title={t("ai.sendHighlightedText.title")}
          description={t("ai.sendHighlightedText.description")}
          control={
            <Toggle
              aria-label={t("ai.sendHighlightedText.title")}
              checked={prefs.sendHighlightedText}
              onChange={(sendHighlightedText) => setPrefs({ ...prefs, sendHighlightedText })}
            />
          }
        />
        <SettingsRow
          title={t("ai.sendSurroundingContext.title")}
          description={t("ai.sendSurroundingContext.description")}
          control={
            <Toggle
              aria-label={t("ai.sendSurroundingContext.title")}
              checked={prefs.sendSurroundingContext}
              onChange={(sendSurroundingContext) =>
                setPrefs({ ...prefs, sendSurroundingContext })
              }
            />
          }
        />
        <SettingsRow
          title={t("ai.localOnly.title")}
          description={t("ai.localOnly.description")}
          control={
            <Toggle
              aria-label={t("ai.localOnly.title")}
              checked={prefs.localOnly}
              onChange={(localOnly) => setPrefs({ ...prefs, localOnly })}
            />
          }
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
