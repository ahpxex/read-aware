/**
 * Settings → Menus: arrange the customizable surfaces (primary navigation,
 * shelf header, reader header, the phone reader toolbar, selection menu) and
 * the reader header/footer strips by dragging items between zones.
 * (docs/plugins/plugin-system.md §7).
 */
import { Fragment } from "react";
import { useTranslation } from "../../../i18n";
import { HeaderFooterEditor } from "../../menus";
import { MenuSurfaceEditor } from "../../menus/components/MenuSurfaceEditor";
import type { MenuSurface } from "../../menus/state/menu-config";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";

const SURFACES: MenuSurface[] = ["primaryNav", "shelfHeader", "readerHeader", "readerToolbar", "selection"];

export function MenusPanel() {
  const { t } = useTranslation("settings");
  return (
    <SettingsPage title={t("menus.title")} description={t("menus.description")}>
      {SURFACES.map((surface) => (
        <Fragment key={surface}>
          <SettingsGroup title={t(`menus.surface.${surface}` as never)}>
            <MenuSurfaceEditor surface={surface} />
          </SettingsGroup>
          {surface === "readerToolbar" && (
            <SettingsGroup title={t("menus.headerFooter.title")} description={t("menus.headerFooter.description")}>
              <HeaderFooterEditor />
            </SettingsGroup>
          )}
        </Fragment>
      ))}
    </SettingsPage>
  );
}
