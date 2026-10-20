import { Check, CloudArrowDown, Plus, Trash } from "@phosphor-icons/react";
import { Caption, IconButton, ItemList, Spinner, Toggle } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { isUserFont, toUserFont } from "../lib/reader-settings";
import { useFontChoices, type FontChoicesOptions } from "../hooks/useFontChoices";
import { useUserFontManager } from "../hooks/useUserFontManager";
import { FontChoiceStatus } from "./FontField";
import { UserFontRemoveDialog } from "./UserFontRemoveDialog";
import type { UserFontEntry } from "../../../domain/fonts";

type FontListProps = FontChoicesOptions & { className?: string };

/** "TTF · 1.4 MB" — the file facts under an imported font's parsed name. */
function fontMeta(font: UserFontEntry, syncing: string): string {
  const size =
    font.byteSize >= 1024 * 1024
      ? `${(font.byteSize / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(font.byteSize / 1024))} KB`;
  const base = `${font.format.toUpperCase()} · ${size}`;
  return font.bytesLocal ? base : `${base} · ${syncing}`;
}

/**
 * Body-font picker as a list: every choice on its own line, the current one
 * checked, for a page of its own where a dropdown would be one more layer
 * (the phone's appearance drawer). "Custom" swaps the list to this device's
 * fonts — imported font files first (mobile's only custom-font path), then
 * the installed families the desktop enumeration offers.
 */
export function FontList({ className, ...options }: FontListProps) {
  const { t } = useTranslation("settings");
  const fonts = useFontChoices(options);
  const manager = useUserFontManager();
  const { custom } = fonts;
  const systemOptions = fonts.options.filter((option) => !isUserFont(option.value as `user:${string}`));

  return (
    <div className={className}>
      <ItemList>
        <ItemList.Item
          title={t("font.custom")}
          subtitle={t("font.customAria")}
          disclosure="none"
          accessories={<Toggle aria-label={t("font.customAria")} checked={fonts.custom} onChange={fonts.setCustom} />}
        />
        {!custom &&
          fonts.options.map((option) => {
            const selected = option.value === fonts.selectValue;
            return (
              <ItemList.Item
                key={option.value}
                title={option.label}
                disclosure="none"
                selected={selected}
                onClick={() => fonts.choose(option.value)}
                accessories={selected ? <Check size={16} weight="bold" aria-hidden="true" className="text-fg" /> : null}
              />
            );
          })}
        {custom && manager.canImport && (
          <ItemList.Item
            title={t("font.import")}
            icon={<Plus size={17} />}
            disclosure="none"
            onClick={() => void manager.importFonts()}
            accessories={manager.importing ? <Spinner size="sm" /> : null}
          />
        )}
        {custom &&
          manager.userFonts.map((font) => {
            const ref = toUserFont(font.id);
            const selected = ref === fonts.selectValue;
            return (
              <ItemList.Item
                key={font.id}
                title={font.name}
                subtitle={fontMeta(font, t("font.syncing"))}
                disclosure="none"
                selected={selected}
                onClick={ref ? () => fonts.choose(ref) : undefined}
                accessories={
                  <>
                    {!font.bytesLocal && <CloudArrowDown size={16} aria-hidden="true" className="text-fg-subtle" />}
                    <IconButton
                      size="sm"
                      tone="danger"
                      icon={<Trash size={15} />}
                      label={t("font.remove")}
                      onClick={(event) => {
                        event.stopPropagation();
                        manager.askRemoval(font);
                      }}
                    />
                    {selected && <Check size={16} weight="bold" aria-hidden="true" className="text-fg" />}
                  </>
                }
              />
            );
          })}
        {custom && systemOptions.length > 0 && (
          <li className="px-2 pb-1 pt-4">
            <Caption as="span" className="text-fg-subtle">
              {t("font.installed")}
            </Caption>
          </li>
        )}
        {custom &&
          systemOptions.map((option) => {
            const selected = option.value === fonts.selectValue;
            return (
              <ItemList.Item
                key={option.value}
                title={option.label}
                disclosure="none"
                selected={selected}
                onClick={() => fonts.choose(option.value)}
                accessories={selected ? <Check size={16} weight="bold" aria-hidden="true" className="text-fg" /> : null}
              />
            );
          })}
        {custom && manager.userFonts.length === 0 && systemOptions.length === 0 && !fonts.systemLoading && (
          <li className="px-2 py-4">
            <Caption as="span" className="block text-fg-subtle">
              {t("font.emptyCustom")}
            </Caption>
          </li>
        )}
      </ItemList>
      <div className="px-2">
        <FontChoiceStatus fonts={fonts} />
      </div>
      <UserFontRemoveDialog
        font={manager.pendingRemoval}
        busy={manager.removing}
        onClose={manager.cancelRemoval}
        onConfirm={() => void manager.confirmRemoval()}
      />
    </div>
  );
}
