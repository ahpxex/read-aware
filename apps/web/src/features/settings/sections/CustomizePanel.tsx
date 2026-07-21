/**
 * Settings → Customize: one home for everything look-and-layout — Appearance,
 * Reading, and Menus as tabs. Deep-links to the old standalone sections land
 * on the right tab via customizeTabRequestAtom.
 */
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { Tabs } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { customizeTabRequestAtom, type CustomizeTabId } from "../../../state/ui";
import { AppearancePanel } from "./AppearancePanel";
import { MenusPanel } from "./MenusPanel";
import { ReadingPanel } from "./ReadingPanel";

const TAB_ORDER: CustomizeTabId[] = ["appearance", "reading", "menus"];

export function CustomizePanel() {
  const { t } = useTranslation("settings");
  const [tabRequest, setTabRequest] = useAtom(customizeTabRequestAtom);
  const [activeTab, setActiveTab] = useState(() => {
    const index = tabRequest ? TAB_ORDER.indexOf(tabRequest) : 0;
    return index >= 0 ? index : 0;
  });
  // One-shot: the request served its purpose once the initial tab is chosen.
  useEffect(() => {
    if (tabRequest) setTabRequest(null);
  }, [tabRequest, setTabRequest]);

  return (
    <Tabs
      ariaLabel={t("sections.customize")}
      activeIndex={activeTab}
      onActiveIndexChange={setActiveTab}
      tabListClassName="mx-8 mt-6"
      items={[
        { label: t("sections.appearance"), content: <AppearancePanel /> },
        { label: t("sections.reading"), content: <ReadingPanel /> },
        { label: t("sections.menus"), content: <MenusPanel /> },
      ]}
    />
  );
}
