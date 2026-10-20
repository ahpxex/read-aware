import { useMemo } from "react";
import { CloudArrowDown, Plus, Trash } from "@phosphor-icons/react";
import { Button, Caption, IconButton, InlineError, Select, Spinner, Toggle } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { userFontId, type ReaderFontFamily } from "../lib/reader-settings";
import { fontMeta } from "../lib/font-meta";
import { useFontChoices, type FontChoicesOptions } from "../hooks/useFontChoices";
import { useUserFontManager } from "../hooks/useUserFontManager";
import { UserFontRemoveDialog } from "./UserFontRemoveDialog";

type FontFieldProps = FontChoicesOptions & { className?: string };

/**
 * Body-font picker as a dropdown (see useFontChoices for what it offers).
 * Flip the "Custom" switch and the dropdown instead lists this device's
 * fonts — the user's imported font files (mobile's only custom-font path)
 * ahead of the installed families. Imported options carry their file facts
 * and a removal button inside the same list, and the popup's header row is
 * the import action, so everything the user can do with a font lives in the
 * one control. Shared by the Reading panel, the in-reader popover, and the
 * content typography controls.
 */
export function FontField({ className, ...options }: FontFieldProps) {
  const { t } = useTranslation("settings");
  const fonts = useFontChoices(options);
  const manager = useUserFontManager();
  const { custom, setCustom } = fonts;

  const userFontsById = useMemo(() => new Map(manager.userFonts.map((font) => [font.id, font])), [manager.userFonts]);

  const selectOptions = useMemo(() => {
    if (!custom) return fonts.options;
    return fonts.options.map((option) => {
      const font = userFontsById.get(userFontId(option.value as ReaderFontFamily) ?? "");
      if (!font) return option;
      return {
        ...option,
        accessory: (
          <span className="flex shrink-0 items-center gap-2 text-fg-subtle">
            {!font.bytesLocal && <CloudArrowDown size={14} aria-hidden="true" />}
            <span className="text-[11px]">{fontMeta(font, t("font.syncing"))}</span>
            <IconButton
              size="sm"
              tone="danger"
              icon={<Trash size={13} />}
              label={t("font.remove")}
              onClick={(event) => {
                event.stopPropagation();
                manager.askRemoval(font);
              }}
            />
          </span>
        ),
      };
    });
  }, [custom, fonts.options, userFontsById, manager, t]);

  return (
    <div className={cn("relative", className)}>
      <label className="absolute right-0 top-0 z-[1] inline-flex cursor-pointer items-center gap-2">
        <span className="font-sans text-[13px] text-fg-muted">{t("font.custom")}</span>
        <Toggle aria-label={t("font.customAria")} checked={custom} onChange={setCustom} />
      </label>
      <Select
        label={t("font.label")}
        value={fonts.selectValue}
        options={selectOptions}
        placeholder={custom ? t("font.placeholderCustom") : t("font.placeholderCurated")}
        onChange={fonts.choose}
        helperText={custom && selectOptions.length === 0 && !fonts.systemLoading ? t("font.emptyCustom") : undefined}
        popupHeader={
          custom && manager.canImport
            ? (close) => (
                <>
                  {/* oxlint-disable-next-line react/forbid-elements -- an action row inside the listbox popup must render like an option, not like a Button variant */}
                  <button
                    type="button"
                    disabled={manager.importing}
                    onClick={() => {
                      close();
                      void manager.importFonts();
                    }}
                    className="mb-1 flex w-full items-center gap-2 rounded-md border-b border-border px-2.5 pb-2 pt-1.5 text-left text-sm text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                  >
                    {manager.importing ? <Spinner size="sm" className="h-3.5 w-3.5" /> : <Plus size={15} />}
                    {t("font.import")}
                  </button>
                </>
              )
            : undefined
        }
      />
      <FontChoiceStatus fonts={fonts} />
      <UserFontRemoveDialog
        font={manager.pendingRemoval}
        busy={manager.removing}
        onClose={manager.cancelRemoval}
        onConfirm={() => void manager.confirmRemoval()}
      />
    </div>
  );
}

/** The download and device-list states under a font picker. */
export function FontChoiceStatus({ fonts }: { fonts: ReturnType<typeof useFontChoices> }) {
  const { t } = useTranslation("settings");
  const { custom, systemLoading, systemFailure, retrySystemFonts, fontFace } = fonts;
  return (
    <>
      {custom && systemLoading && <Spinner size="sm" className="mt-1.5" />}
      {custom && systemFailure && (
        <InlineError
          compact
          onRetry={systemFailure.retryable ? retrySystemFonts : undefined}
          retryLabel={t("font.retry")}
        >
          {systemFailure.body}
        </InlineError>
      )}
      {/* Download feedback for curated fonts — fetched from a CDN on first use,
          which can be slow or unreachable; silence here read as a broken picker. */}
      {fontFace.status === "loading" && (
        <div className="mt-1.5 flex items-center gap-2 text-fg-muted">
          <Spinner size="sm" className="h-3 w-3" />
          <Caption>{t("font.downloading", { percent: Math.round(fontFace.progress * 100) })}</Caption>
        </div>
      )}
      {fontFace.status === "error" && (
        <div className="mt-1.5 flex items-center gap-2">
          <Caption className="text-red-800">{t("font.downloadFailed")}</Caption>
          <Button size="sm" variant="link" onClick={fontFace.retry}>
            {t("font.retry")}
          </Button>
        </div>
      )}
    </>
  );
}
