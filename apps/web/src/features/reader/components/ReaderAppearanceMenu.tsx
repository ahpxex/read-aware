import { TextAa } from "@phosphor-icons/react";
import { useAtomValue } from "jotai";
import { Caption, ChoiceGroup, Divider, Popover } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import {
  fixedLayoutColorOptions,
  fontSizeOptions,
  fontWeightOptions,
  lineSpacingOptions,
  pageColorOptions,
  pageMarginsOptions,
  paragraphSpacingOptions,
  readingModeOptions,
  textAlignOptions,
} from "../../settings/lib/reader-setting-options";
import { applyReaderThemeSelection } from "../../settings/lib/reader-theme";
import { usePluginReaderThemeOptions } from "../../settings/hooks/usePluginReaderThemeOptions";
import { pluginThemesAtom } from "../../plugins/state/plugin-store";
import { FontField } from "../../settings/components/FontField";
import {
  useReaderAppearance,
  type ReaderAppearanceScope,
} from "../hooks/useReaderAppearance";

type ReaderAppearanceMenuProps = {
  bookId: string;
  /**
   * The open book is fixed-layout (PDF, comic, pre-paginated EPUB): its pages
   * are pictures of a page the publisher already set. See the typography block
   * below for what that hides.
   */
  fixedLayout?: boolean;
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
  fixedLayout = false,
  open,
  onOpenChange,
}: ReaderAppearanceMenuProps) {
  const { t } = useTranslation("reader");
  const { scope, prefs, setScope, updatePrefs } = useReaderAppearance(bookId);
  const pluginThemes = useAtomValue(pluginThemesAtom);
  const pluginThemeOptions = usePluginReaderThemeOptions();

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
          options={[...pageColorOptions(t), ...pluginThemeOptions]}
          onChange={(theme) =>
            updatePrefs(applyReaderThemeSelection(prefs, theme, pluginThemes))
          }
        />
        {/* Typography — reflowable books only. A fixed-layout book is a
            sequence of pages the publisher already typeset: the engine has no
            text to re-flow, so every control here would move a switch that
            changes nothing. Offering them reads as "this book just ignores my
            settings" rather than "this book has none", so they are gone, with a
            line saying why. Page Color and Reading Mode stay: both still do
            visible work on a fixed-layout page. */}
        {fixedLayout ? (
          <>
            <div>
              <ChoiceGroup
                label={t("fixedLayoutColor")}
                value={prefs.fixedLayoutColor}
                options={fixedLayoutColorOptions(t)}
                onChange={(fixedLayoutColor) => updatePrefs({ ...prefs, fixedLayoutColor })}
              />
              <Caption className="mt-1.5 block text-fg-subtle">
                {t("fixedLayoutColorHint")}
              </Caption>
            </div>
            <Caption className="block text-fg-subtle">{t("fixedLayoutHint")}</Caption>
          </>
        ) : (
          <>
            <FontField
              value={prefs.fontFamily}
              fontWeight={prefs.fontWeight}
              onChange={(fontFamily) => updatePrefs({ ...prefs, fontFamily })}
            />
            <ChoiceGroup
              label={t("fontSize")}
              value={prefs.fontSize}
              options={fontSizeOptions(t)}
              onChange={(fontSize) => updatePrefs({ ...prefs, fontSize })}
            />
            <ChoiceGroup
              label={t("fontWeight")}
              value={prefs.fontWeight}
              options={fontWeightOptions(t)}
              onChange={(fontWeight) => updatePrefs({ ...prefs, fontWeight })}
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
              label={t("textAlign")}
              value={prefs.textAlign}
              options={textAlignOptions(t)}
              onChange={(textAlign) => updatePrefs({ ...prefs, textAlign })}
            />
            <ChoiceGroup
              label={t("pageMargins")}
              value={prefs.pageMargins}
              options={pageMarginsOptions(t)}
              onChange={(pageMargins) => updatePrefs({ ...prefs, pageMargins })}
            />
          </>
        )}

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
