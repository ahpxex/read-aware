import { Check, CloudArrowDown, Plus, Trash } from "@phosphor-icons/react";
import { Caption, IconButton, ItemList, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { toUserFont } from "../lib/reader-settings";
import { fontMeta } from "../lib/font-meta";
import { useFontChoices, type FontChoicesOptions } from "../hooks/useFontChoices";
import { useUserFontManager } from "../hooks/useUserFontManager";
import { FontChoiceStatus } from "./FontField";
import { UserFontRemoveDialog } from "./UserFontRemoveDialog";

type FontListProps = FontChoicesOptions & { className?: string };

/**
 * Body-font picker as a list: every choice on its own line, the current one
 * checked, for a page of its own where a dropdown would be one more layer
 * (the phone's appearance drawer). One list in three sections: the curated
 * and plugin fonts, then the user's imported font files (with an import row
 * where the shell can pick files), then the installed families the desktop
 * enumeration offers.
 */
export function FontList({ className, ...options }: FontListProps) {
  const { t } = useTranslation("settings");
  const fonts = useFontChoices(options);
  const manager = useUserFontManager();

  const renderFontRow = (option: { value: string; label: string }) => {
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
  };

  const renderSectionHeader = (title: string) => (
    <li className="px-2 pb-1 pt-4">
      <Caption as="span" className="text-fg-subtle">
        {title}
      </Caption>
    </li>
  );

  return (
    <div className={className}>
      <ItemList>
        {fonts.curatedOptions.map(renderFontRow)}
        {(manager.canImport || manager.userFonts.length > 0) && renderSectionHeader(t("font.imported"))}
        {manager.canImport && (
          <ItemList.Item
            title={t("font.import")}
            icon={<Plus size={17} />}
            disclosure="none"
            onClick={() => void manager.importFonts()}
            accessories={manager.importing ? <Spinner size="sm" /> : null}
          />
        )}
        {manager.userFonts.map((font) => {
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
        {fonts.installedOptions.length > 0 && renderSectionHeader(t("font.installed"))}
        {fonts.installedOptions.map(renderFontRow)}
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
