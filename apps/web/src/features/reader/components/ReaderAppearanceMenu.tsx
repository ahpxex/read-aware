import { TextAa } from "@phosphor-icons/react";
import { useAtomValue } from "jotai";
import { Caption, ChoiceGroup, Divider, Popover } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import {
  fixedLayoutColorOptions,
  pageColorOptions,
  readingModeOptions,
} from "../../settings/lib/reader-setting-options";
import { applyReaderThemeSelection } from "../../settings/lib/reader-theme";
import { usePluginReaderThemeOptions } from "../../settings/hooks/usePluginReaderThemeOptions";
import { pluginThemesAtom } from "../../plugins/state/plugin-store";
import { FontField } from "../../settings/components/FontField";
import { ReaderTypographyControls } from "../../settings/components/ReaderTypographyControls";
import { useReaderAppearance, type ReaderAppearanceScope } from "../hooks/useReaderAppearance";
import { FixedLayoutFitChoice } from "./FixedLayoutZoomControls";

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
export function ReaderAppearanceMenu({ bookId, fixedLayout = false, open, onOpenChange }: ReaderAppearanceMenuProps) {
  const { t } = useTranslation("reader");
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
      <ReaderAppearanceFields bookId={bookId} fixedLayout={fixedLayout} />
    </Popover>
  );
}

/** Shared content for the inline popover and menu-independent host dialog. */
export function ReaderAppearanceFields({
  bookId,
  fixedLayout = false,
}: Pick<ReaderAppearanceMenuProps, "bookId" | "fixedLayout">) {
  const { t } = useTranslation("reader");
  const { scope, prefs, setScope, updatePrefs } = useReaderAppearance(bookId);
  const pluginThemes = useAtomValue(pluginThemesAtom);
  const pluginThemeOptions = usePluginReaderThemeOptions();

  const scopeOptions: { value: ReaderAppearanceScope; label: string }[] = [
    { value: "global", label: t("scope.global") },
    { value: "book", label: t("scope.book") },
  ];

  return (
    <div className="flex w-full flex-col gap-5">
      <div>
        <ChoiceGroup label={t("applyTo")} value={scope} options={scopeOptions} onChange={setScope} />
        <Caption className="mt-1.5 block text-fg-subtle">
          {scope === "book" ? t("scopeHintBook") : t(fixedLayout ? "scopeHintGlobal" : "scopeHintGlobalFonts")}
        </Caption>
      </div>

      <Divider />

      <ChoiceGroup
        label={t("pageColor")}
        value={prefs.theme}
        options={[...pageColorOptions(t), ...pluginThemeOptions]}
        onChange={(theme) => updatePrefs(applyReaderThemeSelection(prefs, theme, pluginThemes))}
      />
      {/* Typography — reflowable books only. A fixed-layout book is a
            sequence of pages the publisher already typeset: the engine has no
            text to re-flow, so every control here would move a switch that
            changes nothing. Offering them reads as "this book just ignores my
            settings" rather than "this book has none", so they are gone, with a
            line saying why. Page Color and Reading Mode stay: both still do
            visible work on a fixed-layout page, and so does the fit its zoom
            measures from. */}
      {fixedLayout ? (
        <>
          {/* The fit belongs to this book on this device whatever the scope
                above says — a zoom answers to one window and one document.
                The zoom itself is set by pinch or the zoom keys, and shows
                its percentage over the page while it changes. */}
          <div>
            <FixedLayoutFitChoice bookId={bookId} scrolled={prefs.fixedLayoutReadingMode === "scroll"} />
            <Caption className="mt-1.5 block text-fg-subtle">{t("pageZoomHint")}</Caption>
          </div>
          <div>
            <ChoiceGroup
              label={t("fixedLayoutColor")}
              value={prefs.fixedLayoutColor}
              options={fixedLayoutColorOptions(t)}
              onChange={(fixedLayoutColor) => updatePrefs({ ...prefs, fixedLayoutColor })}
            />
            <Caption className="mt-1.5 block text-fg-subtle">{t("fixedLayoutColorHint")}</Caption>
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
          <ReaderTypographyControls prefs={prefs} onChange={updatePrefs} />
        </>
      )}

      <Divider />

      {/* Fixed-layout books (PDF, comics) read on their own mode axis, so a
            layout chosen here never drags novels along — and vice versa. */}
      {fixedLayout ? (
        <ChoiceGroup
          label={t("readingMode")}
          value={prefs.fixedLayoutReadingMode}
          options={readingModeOptions(t)}
          onChange={(fixedLayoutReadingMode) => updatePrefs({ ...prefs, fixedLayoutReadingMode })}
        />
      ) : (
        <ChoiceGroup
          label={t("readingMode")}
          value={prefs.readingMode}
          options={readingModeOptions(t)}
          onChange={(readingMode) => updatePrefs({ ...prefs, readingMode })}
        />
      )}
    </div>
  );
}
