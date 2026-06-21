import { useAtom } from "jotai";
import { Stack } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { readerSettingsAtom } from "../../../state/ui";
import type { ReaderTheme, ReaderFontSize, ReaderLineSpacing, ReadingMode } from "../lib/reader-settings";

type OptionGroupProps<T extends string> = {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
};

function OptionGroup<T extends string>({ label, value, options, onChange }: OptionGroupProps<T>) {
  return (
    <fieldset>
      <legend className="mb-2 font-sans text-eyebrow font-medium uppercase tracking-eyebrow text-stone-500">
        {label}
      </legend>
      <div className="flex gap-1.5">
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={cn(
                "rounded-md border px-3.5 py-1.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
                isActive
                  ? "border-stone-950 bg-stone-950 text-white"
                  : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-950",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

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
    <Stack gap="xl">
      <OptionGroup
        label="Reading Mode"
        value={settings.readingMode}
        options={READING_MODE_OPTIONS}
        onChange={(readingMode) => setSettings({ ...settings, readingMode })}
      />
      <OptionGroup
        label="Theme"
        value={settings.theme}
        options={THEME_OPTIONS}
        onChange={(theme) => setSettings({ ...settings, theme })}
      />
      <OptionGroup
        label="Font Size"
        value={settings.fontSize}
        options={FONT_SIZE_OPTIONS}
        onChange={(fontSize) => setSettings({ ...settings, fontSize })}
      />
      <OptionGroup
        label="Line Spacing"
        value={settings.lineSpacing}
        options={LINE_SPACING_OPTIONS}
        onChange={(lineSpacing) => setSettings({ ...settings, lineSpacing })}
      />
      <p className="text-xs text-stone-500">
        Changes apply immediately to the reader.
      </p>
    </Stack>
  );
}
