import { Button } from "@read-aware/ui";
import { isTauri } from "../../../platform/environment";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { PendingBadge } from "../components/PendingBadge";

const APP_VERSION = "0.1.0";

function valueText(text: string) {
  return <span className="font-sans text-sm text-fg-muted">{text}</span>;
}

export function AboutPanel() {
  return (
    <SettingsPage title="About" description="Version, build, and the engine that powers reading.">
      <SettingsGroup title="ReadAware">
        <SettingsRow borderless title="Version" control={valueText(APP_VERSION)} />
        <SettingsRow title="Build" control={valueText(isTauri() ? "Desktop (Tauri)" : "Web preview")} />
        <SettingsRow
          title="Updates"
          description="Check for and install the latest release."
          control={
            <span className="flex items-center gap-2">
              <PendingBadge />
              <Button variant="outline" size="sm" disabled>
                Check for updates
              </Button>
            </span>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Reading engine"
        description="Every format — EPUB, MOBI, AZW3, FB2, PDF — renders through one vendored engine."
      >
        <SettingsRow
          borderless
          title="foliate-js"
          description="The open-source reading engine ReadAware is built on."
          control={valueText("Vendored")}
        />
      </SettingsGroup>

      <SettingsGroup title="Help">
        <SettingsRow
          borderless
          title="Send feedback"
          description="Report a bug or share what's not working."
          control={
            <span className="flex items-center gap-2">
              <PendingBadge />
              <Button variant="outline" size="sm" disabled>
                Report an issue
              </Button>
            </span>
          }
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
