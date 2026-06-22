import { useAtom, useAtomValue } from "jotai";
import { ChoiceGroup, Stack } from "@read-aware/ui";
import { effectiveReaderSettingsAtom, readerPreferencesAtom } from "../../../state/ui";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { getReaderPreviewStyle } from "../lib/reader-css";
import type {
  ReaderContentWidth,
  ReaderFontFamily,
  ReaderFontSize,
  ReaderLineSpacing,
  ReaderMargins,
  ReaderParagraphSpacing,
  ReaderTextAlign,
  ReaderThemePreference,
  ReadingMode,
} from "../lib/reader-settings";

const FONT_FAMILY_OPTIONS: { value: ReaderFontFamily; label: string }[] = [
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
];

const FONT_SIZE_OPTIONS: { value: ReaderFontSize; label: string }[] = [
  { value: "x-small", label: "XS" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "x-large", label: "XL" },
];

const LINE_SPACING_OPTIONS: { value: ReaderLineSpacing; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "relaxed", label: "Relaxed" },
];

const PARAGRAPH_SPACING_OPTIONS: { value: ReaderParagraphSpacing; label: string }[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "loose", label: "Loose" },
];

const READING_MODE_OPTIONS: { value: ReadingMode; label: string }[] = [
  { value: "scroll", label: "Scroll" },
  { value: "paginated-single", label: "Single Page" },
  { value: "paginated-double", label: "Two Pages" },
];

const CONTENT_WIDTH_OPTIONS: { value: ReaderContentWidth; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "medium", label: "Medium" },
  { value: "wide", label: "Wide" },
];

const MARGINS_OPTIONS: { value: ReaderMargins; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "normal", label: "Normal" },
  { value: "spacious", label: "Spacious" },
];

const TEXT_ALIGN_OPTIONS: { value: ReaderTextAlign; label: string }[] = [
  { value: "start", label: "Left" },
  { value: "justify", label: "Justified" },
];

const PAGE_COLOR_OPTIONS: { value: ReaderThemePreference; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "warm", label: "Warm" },
  { value: "dark", label: "Dark" },
];

export function ReadingPanel() {
  const [prefs, setPrefs] = useAtom(readerPreferencesAtom);
  const effective = useAtomValue(effectiveReaderSettingsAtom);

  return (
    <SettingsPage
      title="Reading"
      description="How books render on the page. Changes apply live to the reader."
    >
      <ReadingPreview style={getReaderPreviewStyle(effective)} />

      <SettingsGroup title="Typography">
        <Stack gap="lg">
          <ChoiceGroup
            label="Font"
            value={prefs.fontFamily}
            options={FONT_FAMILY_OPTIONS}
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
          <ChoiceGroup
            label="Content Width"
            value={prefs.contentWidth}
            options={CONTENT_WIDTH_OPTIONS}
            onChange={(contentWidth) => setPrefs({ ...prefs, contentWidth })}
          />
          <ChoiceGroup
            label="Page Margins"
            value={prefs.margins}
            options={MARGINS_OPTIONS}
            onChange={(margins) => setPrefs({ ...prefs, margins })}
          />
          <ChoiceGroup
            label="Text Alignment"
            value={prefs.textAlign}
            options={TEXT_ALIGN_OPTIONS}
            onChange={(textAlign) => setPrefs({ ...prefs, textAlign })}
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
