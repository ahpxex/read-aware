import { TextAa } from "@phosphor-icons/react";
import { Caption, ChoiceGroup, Divider, Popover } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import {
  fontSizeOptions,
  lineSpacingOptions,
  pageColorOptions,
  pageMarginsOptions,
  paragraphSpacingOptions,
  readingModeOptions,
} from "../../settings/lib/reader-setting-options";
import { FontField } from "../../settings/components/FontField";
import {
  useReaderAppearance,
  type ReaderAppearanceScope,
} from "../hooks/useReaderAppearance";

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
  const { t } = useTranslation("reader");
  const { scope, prefs, setScope, updatePrefs } = useReaderAppearance(bookId);

  const scopeOptions: { value: ReaderAppearanceScope; label: string }[] = [
    { value: "global", label: t("scope.global") },
    { value: "book", label: t("scope.book") },
  ];

  return (
    <Popover
      align="right"
      triggerLabel={t("readingAppearance")}
      triggerTooltip={t("readingAppearance")}
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
            label={t("applyTo")}
            value={scope}
            options={scopeOptions}
            onChange={setScope}
          />
          <Caption className="mt-1.5 block text-fg-subtle">
            {scope === "book" ? t("scopeHintBook") : t("scopeHintGlobal")}
          </Caption>
        </div>

        <Divider />

        <ChoiceGroup
          label={t("pageColor")}
          value={prefs.theme}
          options={pageColorOptions(t)}
          onChange={(theme) => updatePrefs({ ...prefs, theme })}
        />
        <FontField
          value={prefs.fontFamily}
          onChange={(fontFamily) => updatePrefs({ ...prefs, fontFamily })}
        />
        <ChoiceGroup
          label={t("fontSize")}
          value={prefs.fontSize}
          options={fontSizeOptions(t)}
          onChange={(fontSize) => updatePrefs({ ...prefs, fontSize })}
        />
        <ChoiceGroup
          label={t("lineSpacing")}
          value={prefs.lineSpacing}
          options={lineSpacingOptions(t)}
          onChange={(lineSpacing) => updatePrefs({ ...prefs, lineSpacing })}
        />
        <ChoiceGroup
          label={t("paragraphSpacing")}
          value={prefs.paragraphSpacing}
          options={paragraphSpacingOptions(t)}
          onChange={(paragraphSpacing) => updatePrefs({ ...prefs, paragraphSpacing })}
        />
        <ChoiceGroup
          label={t("pageMargins")}
          value={prefs.pageMargins}
          options={pageMarginsOptions(t)}
          onChange={(pageMargins) => updatePrefs({ ...prefs, pageMargins })}
        />

        <Divider />

        <ChoiceGroup
          label={t("readingMode")}
          value={prefs.readingMode}
          options={readingModeOptions(t)}
          onChange={(readingMode) => updatePrefs({ ...prefs, readingMode })}
        />
      </div>
    </Popover>
  );
}
