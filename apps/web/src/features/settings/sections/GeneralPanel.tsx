import { useAtom } from "jotai";
import { ChoiceGroup, Select, Toggle } from "@read-aware/ui";
import { generalSettingsAtom } from "../../../state/ui";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import type { StartView } from "../lib/general-settings";

const START_VIEW_OPTIONS: { value: StartView; label: string }[] = [
  { value: "shelf", label: "Library shelf" },
  { value: "resume", label: "Resume last book" },
];

const LANGUAGE_OPTIONS = [{ value: "en", label: "English" }];

export function GeneralPanel() {
  const [settings, setSettings] = useAtom(generalSettingsAtom);

  return (
    <SettingsPage
      title="General"
      description="App-wide behavior — what opens on launch, language, and desktop integration."
    >
      <SettingsGroup title="On launch">
        <ChoiceGroup
          label="Start view"
          value={settings.startView}
          options={START_VIEW_OPTIONS}
          onChange={(startView) => setSettings({ ...settings, startView })}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Desktop integration"
        description="Stored here and applied by the desktop app. No effect in the browser preview."
      >
        <SettingsRow
          borderless
          title="Launch at startup"
          description="Open ReadAware automatically when you sign in."
          control={
            <Toggle
              aria-label="Launch at startup"
              checked={settings.launchAtStartup}
              onChange={(launchAtStartup) => setSettings({ ...settings, launchAtStartup })}
            />
          }
        />
        <SettingsRow
          title="File associations"
          description="Open EPUB, MOBI, AZW3, FB2 and PDF files with ReadAware."
          control={
            <Toggle
              aria-label="File associations"
              checked={settings.fileAssociations}
              onChange={(fileAssociations) => setSettings({ ...settings, fileAssociations })}
            />
          }
        />
        <SettingsRow
          title="Automatic updates"
          description="Download and install new versions in the background."
          control={
            <Toggle
              aria-label="Automatic updates"
              checked={settings.autoUpdate}
              onChange={(autoUpdate) => setSettings({ ...settings, autoUpdate })}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Language & privacy">
        <div className="pb-1">
          <Select
            label="Language"
            value={settings.language}
            onChange={() => undefined}
            options={LANGUAGE_OPTIONS}
            disabled
          />
        </div>
        <SettingsRow
          title="Send anonymous crash reports"
          description="Share crash diagnostics to help fix stability issues. Off by default."
          control={
            <Toggle
              aria-label="Send anonymous crash reports"
              checked={settings.crashReports}
              onChange={(crashReports) => setSettings({ ...settings, crashReports })}
            />
          }
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
