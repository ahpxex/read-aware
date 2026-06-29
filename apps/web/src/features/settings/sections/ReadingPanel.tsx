import { useAtom, useAtomValue } from "jotai";
import { ChoiceGroup, Stack } from "@read-aware/ui";
import { effectiveReaderSettingsAtom, readerPreferencesAtom } from "../../../state/ui";
import { FontField } from "../components/FontField";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { getReaderPreviewStyle } from "../lib/reader-css";
import {
  FONT_SIZE_OPTIONS,
  LINE_SPACING_OPTIONS,
  PAGE_COLOR_OPTIONS,
  PARAGRAPH_SPACING_OPTIONS,
  READING_MODE_OPTIONS,
} from "../lib/reader-setting-options";

export function ReadingPanel() {
  const [prefs, setPrefs] = useAtom(readerPreferencesAtom);
  const effective = useAtomValue(effectiveReaderSettingsAtom);

  return (
    <SettingsPage
      title="Reading"
      description="How books render on the page. Changes apply live to the reader."
    >
      {/* Live preview pinned to the top of the scroll area, so every control
          below shows its effect without scrolling back up. The negative margins
          bleed the opaque backdrop to the panel edges, covering controls that
          scroll underneath. */}
      <div className="sticky top-0 z-10 -mx-6 bg-[var(--ra-main-surface-color)] px-6 pb-4 sm:-mx-10 sm:px-10">
        <ReadingPreview style={getReaderPreviewStyle(effective)} />
      </div>

      <SettingsGroup title="Typography">
        <Stack gap="lg">
          <FontField
            value={prefs.fontFamily}
            onChange={(fontFamily) => setPrefs({ ...prefs, fontFamily })}
          />
          <ChoiceGroup
            label="Font Size"
            value={prefs.fontSize}
            options={FONT_SIZE_OPTIONS}
            onChange={(fontSize) => setPrefs({ ...prefs, fontSize })}
          />
          <ChoiceGroup
            label="Line Spacing"
            value={prefs.lineSpacing}
            options={LINE_SPACING_OPTIONS}
            onChange={(lineSpacing) => setPrefs({ ...prefs, lineSpacing })}
          />
          <ChoiceGroup
            label="Paragraph Spacing"
            value={prefs.paragraphSpacing}
            options={PARAGRAPH_SPACING_OPTIONS}
            onChange={(paragraphSpacing) => setPrefs({ ...prefs, paragraphSpacing })}
          />
        </Stack>
      </SettingsGroup>

      <SettingsGroup title="Layout">
        <Stack gap="lg">
          <ChoiceGroup
            label="Reading Mode"
            value={prefs.readingMode}
            options={READING_MODE_OPTIONS}
            onChange={(readingMode) => setPrefs({ ...prefs, readingMode })}
          />
        </Stack>
      </SettingsGroup>

      <SettingsGroup
        title="Page Color"
        description="The book's paper. Auto follows the app theme; the others are fixed."
      >
        <ChoiceGroup
          value={prefs.theme}
          options={PAGE_COLOR_OPTIONS}
          onChange={(theme) => setPrefs({ ...prefs, theme })}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}

function ReadingPreview({ style }: { style: React.CSSProperties }) {
  return (
    <div
      className="overflow-hidden rounded-md border border-border"
      aria-label="Reading preview"
    >
      <div className="px-6 py-5 transition-colors" style={style}>
        <p style={{ margin: 0 }}>
          She had read of such places, but had never thought to stand in one — a quiet room
          where the afternoon settled like dust, and every book on every shelf seemed to lean,
          just slightly, toward whoever was willing to listen.
        </p>
      </div>
    </div>
  );
}
