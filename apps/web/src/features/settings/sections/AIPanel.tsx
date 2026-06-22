import { useAtom } from "jotai";
import { Button, Toggle } from "@read-aware/ui";
import { aiPreferencesAtom } from "../../../state/ui";
import { AIConfigPanel } from "../components/AIConfigPanel";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { PendingBadge } from "../components/PendingBadge";
import { AI_FEATURE_META } from "../lib/ai-preferences";

export function AIPanel() {
  const [prefs, setPrefs] = useAtom(aiPreferencesAtom);

  return (
    <SettingsPage
      title="AI"
      description="Bring your own model key, then choose what the assistant can do and what it may see."
    >
      <SettingsGroup title="Connection">
        <AIConfigPanel />
      </SettingsGroup>

      <SettingsGroup
        title="Features"
        description="Reader assistance, switched on per capability as each one ships."
      >
        {AI_FEATURE_META.map((feature, index) => (
          <SettingsRow
            key={feature.key}
            borderless={index === 0}
            title={feature.label}
            description={feature.description}
            control={
              <Toggle
                aria-label={feature.label}
                checked={prefs.features[feature.key]}
                onChange={(enabled) =>
                  setPrefs({
                    ...prefs,
                    features: { ...prefs.features, [feature.key]: enabled },
                  })
                }
              />
            }
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Memory">
        <SettingsRow
          borderless
          title="Build long-term memory"
          description="Let ReadAware learn a durable profile from your reading and notes over time."
          control={
            <Toggle
              aria-label="Build long-term memory"
              checked={prefs.buildMemory}
              onChange={(buildMemory) => setPrefs({ ...prefs, buildMemory })}
            />
          }
        />
        <SettingsRow
          title="Stored memory"
          description="Review or erase everything ReadAware has remembered about you."
          control={
            <span className="flex items-center gap-2">
              <PendingBadge />
              <Button variant="outline" size="sm" disabled>
                Clear memory
              </Button>
            </span>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Privacy"
        description="Control what leaves your device when an AI feature runs."
      >
        <SettingsRow
          borderless
          title="Send highlighted text"
          description="Include the passage you selected in the request."
          control={
            <Toggle
              aria-label="Send highlighted text"
              checked={prefs.sendHighlightedText}
              onChange={(sendHighlightedText) => setPrefs({ ...prefs, sendHighlightedText })}
            />
          }
        />
        <SettingsRow
          title="Send surrounding context"
          description="Include nearby paragraphs so answers stay grounded in the text."
          control={
            <Toggle
              aria-label="Send surrounding context"
              checked={prefs.sendSurroundingContext}
              onChange={(sendSurroundingContext) =>
                setPrefs({ ...prefs, sendSurroundingContext })
              }
            />
          }
        />
        <SettingsRow
          title="Local-only mode"
          description="Never call a remote model. AI features stay off until a local model is available."
          control={
            <Toggle
              aria-label="Local-only mode"
              checked={prefs.localOnly}
              onChange={(localOnly) => setPrefs({ ...prefs, localOnly })}
            />
          }
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
