import { useAtom } from "jotai";
import { ChoiceGroup, Toggle } from "@read-aware/ui";
import { appSettingsAtom } from "../../../state/ui";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import type { AppThemePreference } from "../lib/app-settings";

const THEME_OPTIONS: { value: AppThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function AppearancePanel() {
  const [settings, setSettings] = useAtom(appSettingsAtom);

  return (
    <SettingsPage
      title="Appearance"
      description="How the app itself looks — independent of the book page color in Reading."
    >
      <SettingsGroup
        title="Theme"
        description="System follows your operating system's light or dark setting."
      >
        <ChoiceGroup
          value={settings.theme}
          options={THEME_OPTIONS}
          onChange={(theme) => setSettings({ ...settings, theme })}
        />
      </SettingsGroup>

      <SettingsGroup title="Motion">
        <SettingsRow
          borderless
          title="Reduce motion"
          description="Turn off transitions and animation flourishes across the app."
          control={
            <Toggle
              aria-label="Reduce motion"
              checked={settings.motion === "reduced"}
              onChange={(reduced) =>
                setSettings({ ...settings, motion: reduced ? "reduced" : "system" })
              }
            />
          }
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
