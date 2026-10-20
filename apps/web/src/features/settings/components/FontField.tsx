import { CloudArrowDown, Plus, Trash } from "@phosphor-icons/react";
import { Button, Caption, IconButton, InlineError, Select, Spinner, Toggle } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { useFontChoices, type FontChoicesOptions } from "../hooks/useFontChoices";
import { useUserFontManager } from "../hooks/useUserFontManager";
import { UserFontRemoveDialog } from "./UserFontRemoveDialog";

type FontFieldProps = FontChoicesOptions & { className?: string };

/**
 * Body-font picker as a dropdown (see useFontChoices for what it offers).
 * Flip the "Custom" switch and the dropdown instead lists this device's
 * fonts — the user's imported font files (mobile's only custom-font path)
 * ahead of the installed families — and an import/manage block opens below.
 * Shared by the Reading panel, the in-reader popover, and the content
 * typography controls.
 */
export function FontField({ className, ...options }: FontFieldProps) {
  const { t } = useTranslation("settings");
  const fonts = useFontChoices(options);
  const manager = useUserFontManager();
  const { custom, setCustom } = fonts;

  return (
    <div className={cn("relative", className)}>
      <label className="absolute right-0 top-0 z-[1] inline-flex cursor-pointer items-center gap-2">
        <span className="font-sans text-[13px] text-fg-muted">{t("font.custom")}</span>
        <Toggle aria-label={t("font.customAria")} checked={custom} onChange={setCustom} />
      </label>
      <Select
        label={t("font.label")}
        value={fonts.selectValue}
        options={fonts.options}
        placeholder={custom ? t("font.placeholderCustom") : t("font.placeholderCurated")}
        onChange={fonts.choose}
      />
      {custom && (
        <div className="mt-2">
          <Button
            size="sm"
            variant="link"
            className="inline-flex items-center gap-1.5"
            onClick={() => void manager.importFonts()}
            disabled={!manager.canImport || manager.importing}
          >
            {manager.importing ? <Spinner size="sm" className="h-3 w-3" /> : <Plus size={13} />}
            {t("font.import")}
          </Button>
          {manager.userFonts.map((font) => (
            <div key={font.id} className="flex items-center gap-2 px-1 py-1">
              <span className="min-w-0 flex-1 truncate font-sans text-[13px] text-fg">{font.name}</span>
              {!font.bytesLocal && (
                <span className="inline-flex items-center gap-1 text-fg-subtle">
                  <CloudArrowDown size={14} aria-hidden="true" />
                  <Caption as="span">{t("font.syncing")}</Caption>
                </span>
              )}
              <Caption as="span" className="shrink-0 text-fg-subtle">
                {font.format.toUpperCase()}
              </Caption>
              <IconButton
                size="sm"
                tone="danger"
                icon={<Trash size={14} />}
                label={t("font.remove")}
                onClick={() => manager.askRemoval(font)}
              />
            </div>
          ))}
          {manager.userFonts.length === 0 && fonts.options.length === 0 && !fonts.systemLoading && (
            <Caption as="span" className="mt-1 block text-fg-subtle">
              {t("font.emptyCustom")}
            </Caption>
          )}
        </div>
      )}
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
