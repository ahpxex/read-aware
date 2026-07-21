/**
 * Settings → Menus: arrange the customizable surfaces (shelf header, reader
 * header, selection menu) by dragging items between Shown and the overflow
 * menu — core and plugin items alike (docs/plugin-system.md §7).
 */
import { useTranslation } from "../../../i18n";
import { MenuSurfaceEditor } from "../../menus/components/MenuSurfaceEditor";
import type { MenuSurface } from "../../menus/state/menu-config";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";

const SURFACES: MenuSurface[] = ["shelfHeader", "readerHeader", "selection"];

export function MenusPanel() {
  const { t } = useTranslation("settings");
  return (
    <SettingsPage title={t("menus.title")} description={t("menus.description")}>
      {SURFACES.map((surface) => (
        <SettingsGroup key={surface} title={t(`menus.surface.${surface}` as never)}>
          <MenuSurfaceEditor surface={surface} />
        </SettingsGroup>
      ))}
    </SettingsPage>
  );
}
