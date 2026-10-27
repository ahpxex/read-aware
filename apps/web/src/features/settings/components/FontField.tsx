import { useMemo } from "react";
import { CloudArrowDown, Plus, Trash } from "@phosphor-icons/react";
import { Button, Caption, IconButton, InlineError, SearchSelect, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { fontMeta } from "../lib/font-meta";
import { useFontChoices, type FontChoicesOptions } from "../hooks/useFontChoices";
import { useUserFontManager } from "../hooks/useUserFontManager";
import { UserFontRemoveDialog } from "./UserFontRemoveDialog";

type FontFieldProps = FontChoicesOptions & { className?: string };

/**
 * Body-font picker as a searchable dropdown — one list in three sections (see
 * useFontChoices): curated and plugin fonts, then the user's imported font
 * files (each carrying its file facts and a removal button), then the fonts
 * installed on this device. The popup's pinned footer row is the import
 * action, so everything the user can do with a font lives in the one
 * control. Shared by the Reading panel, the in-reader popover, and the
 * content typography controls.
 */
export function FontField({ className, ...options }: FontFieldProps) {
  const { t } = useTranslation("settings");
  const fonts = useFontChoices(options);
  const manager = useUserFontManager();

  const selectOptions = useMemo(
    () => [
      ...fonts.curatedOptions,
      ...fonts.importedOptions.map((option) => ({
        value: option.value,
        label: option.label,
        group: t("font.imported"),
        accessory: (
          <span className="flex shrink-0 items-center gap-2 text-fg-subtle">
            {!option.font.bytesLocal && <CloudArrowDown size={14} aria-hidden="true" />}
            <span className="text-[11px]">{fontMeta(option.font, t("font.syncing"))}</span>
            <IconButton
              size="sm"
              icon={<Trash size={13} />}
              label={t("font.remove")}
              onClick={(event) => {
                event.stopPropagation();
                manager.askRemoval(option.font);
              }}
            />
          </span>
        ),
      })),
      ...fonts.installedOptions.map((option) => ({ ...option, group: t("font.installed") })),
    ],
    [fonts.curatedOptions, fonts.importedOptions, fonts.installedOptions, manager, t],
  );

  return (
    <div className={cn("relative", className)}>
      <SearchSelect
        label={t("font.label")}
        value={fonts.selectValue}
        options={selectOptions}
        onChange={fonts.choose}
        matchValue={false}
        searchLabel={t("font.search")}
        emptyText={t("font.noMatch")}
        placeholder={t("font.placeholder")}
        footer={
          manager.canImport
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
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-fill hover:text-fg"
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
  const { systemFailure, retrySystemFonts, fontFace } = fonts;
  return (
    <>
      {systemFailure && (
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
