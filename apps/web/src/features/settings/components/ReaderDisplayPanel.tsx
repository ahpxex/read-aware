import { useAtom } from "jotai";
import { ChoiceGroup, Stack } from "@read-aware/ui";
import { readerSettingsAtom } from "../../../state/ui";
import type {
  ReaderFontSize,
  ReaderLineSpacing,
  ReaderTheme,
  ReadingMode,
} from "../lib/reader-settings";

const READING_MODE_OPTIONS: { value: ReadingMode; label: string }[] = [
  { value: "scroll", label: "Scroll" },
  { value: "paginated-single", label: "Single Page" },
  { value: "paginated-double", label: "Two Pages" },
];

const THEME_OPTIONS: { value: ReaderTheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "warm", label: "Warm" },
  { value: "dark", label: "Dark" },
];

const FONT_SIZE_OPTIONS: { value: ReaderFontSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

const LINE_SPACING_OPTIONS: { value: ReaderLineSpacing; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "relaxed", label: "Relaxed" },
];

export function ReaderDisplayPanel() {
  const [settings, setSettings] = useAtom(readerSettingsAtom);

  return (
    <Stack gap="lg">
      <ChoiceGroup
        label="Reading Mode"
        value={settings.readingMode}
        options={READING_MODE_OPTIONS}
        onChange={(readingMode) => setSettings({ ...settings, readingMode })}
      />
      <ChoiceGroup
        label="Theme"
        value={settings.theme}
        options={THEME_OPTIONS}
        onChange={(theme) => setSettings({ ...settings, theme })}
      />
      <ChoiceGroup
        label="Font Size"
        value={settings.fontSize}
        options={FONT_SIZE_OPTIONS}
        onChange={(fontSize) => setSettings({ ...settings, fontSize })}
      />
      <ChoiceGroup
        label="Line Spacing"
        value={settings.lineSpacing}
        options={LINE_SPACING_OPTIONS}
        onChange={(lineSpacing) => setSettings({ ...settings, lineSpacing })}
      />
    </Stack>
  );
}
