import { TextAa } from "@phosphor-icons/react";
import { Caption, ChoiceGroup, Divider, Popover } from "@read-aware/ui";
import {
  CONTENT_WIDTH_OPTIONS,
  FONT_SIZE_OPTIONS,
  LINE_SPACING_OPTIONS,
  MARGINS_OPTIONS,
  PAGE_COLOR_OPTIONS,
  PARAGRAPH_SPACING_OPTIONS,
  READING_MODE_OPTIONS,
  TEXT_ALIGN_OPTIONS,
} from "../../settings/lib/reader-setting-options";
import { FontField } from "../../settings/components/FontField";
import {
  useReaderAppearance,
  type ReaderAppearanceScope,
} from "../hooks/useReaderAppearance";

const SCOPE_OPTIONS: { value: ReaderAppearanceScope; label: string }[] = [
  { value: "global", label: "All books" },
  { value: "book", label: "This book" },
];

type ReaderAppearanceMenuProps = {
  bookId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * In-reader appearance controls. The "Apply to" toggle decides whether edits
 * change the shared global settings or just this book; the controls below read
 * and write whichever scope is active.
 */
export function ReaderAppearanceMenu({
  bookId,
  open,
  onOpenChange,
}: ReaderAppearanceMenuProps) {
  const { scope, prefs, setScope, updatePrefs } = useReaderAppearance(bookId);

  return (
    <Popover
      align="right"
      triggerLabel="Reading appearance"
      triggerTooltip="Reading appearance"
      className="pointer-events-auto"
      triggerClassName="h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
      trigger={<TextAa size={18} weight="regular" aria-hidden="true" />}
      open={open}
      onOpenChange={onOpenChange}
      panelClassName="max-h-[min(72vh,34rem)] w-80 overflow-y-auto"
    >
      <div className="flex w-full flex-col gap-5">
        <div>
          <ChoiceGroup
            label="Apply to"
            value={scope}
            options={SCOPE_OPTIONS}
            onChange={setScope}
          />
          <Caption className="mt-1.5 block text-fg-subtle">
            {scope === "book"
              ? "Changes affect this book only."
              : "Changes affect every book that follows your global settings."}
          </Caption>
        </div>

        <Divider />

        <ChoiceGroup
          label="Page Color"
          value={prefs.theme}
          options={PAGE_COLOR_OPTIONS}
          onChange={(theme) => updatePrefs({ ...prefs, theme })}
        />
        <FontField
          value={prefs.fontFamily}
          onChange={(fontFamily) => updatePrefs({ ...prefs, fontFamily })}
        />
        <ChoiceGroup
          label="Font Size"
          value={prefs.fontSize}
          options={FONT_SIZE_OPTIONS}
          onChange={(fontSize) => updatePrefs({ ...prefs, fontSize })}
        />
        <ChoiceGroup
          label="Line Spacing"
          value={prefs.lineSpacing}
          options={LINE_SPACING_OPTIONS}
          onChange={(lineSpacing) => updatePrefs({ ...prefs, lineSpacing })}
        />
        <ChoiceGroup
          label="Paragraph Spacing"
          value={prefs.paragraphSpacing}
          options={PARAGRAPH_SPACING_OPTIONS}
          onChange={(paragraphSpacing) => updatePrefs({ ...prefs, paragraphSpacing })}
        />

        <Divider />

        <ChoiceGroup
          label="Reading Mode"
          value={prefs.readingMode}
          options={READING_MODE_OPTIONS}
          onChange={(readingMode) => updatePrefs({ ...prefs, readingMode })}
        />
        <ChoiceGroup
          label="Content Width"
          value={prefs.contentWidth}
          options={CONTENT_WIDTH_OPTIONS}
          onChange={(contentWidth) => updatePrefs({ ...prefs, contentWidth })}
        />
        <ChoiceGroup
          label="Page Margins"
          value={prefs.margins}
          options={MARGINS_OPTIONS}
          onChange={(margins) => updatePrefs({ ...prefs, margins })}
        />
        <ChoiceGroup
          label="Text Alignment"
          value={prefs.textAlign}
          options={TEXT_ALIGN_OPTIONS}
          onChange={(textAlign) => updatePrefs({ ...prefs, textAlign })}
        />
      </div>
    </Popover>
  );
}
