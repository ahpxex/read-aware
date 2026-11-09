import { useAtom } from "jotai";
import { ChoiceGroup } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { readerToolbarPlacementAtom, type ReaderToolbarPlacement } from "../state/reader-toolbar-placement";

/** Settings → Menus: whether a phone's reader actions sit at the bottom or the top. */
export function ReaderToolbarPlacementChoice() {
  const { t } = useTranslation("settings");
  const [placement, setPlacement] = useAtom(readerToolbarPlacementAtom);
  return (
    <ChoiceGroup<ReaderToolbarPlacement>
      label={t("menus.toolbarPlacement.label")}
      value={placement}
      onChange={setPlacement}
      options={[
        { value: "bottom", label: t("menus.toolbarPlacement.bottom") },
        { value: "top", label: t("menus.toolbarPlacement.top") },
      ]}
    />
  );
}
