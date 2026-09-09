import type { EventOrigin, HostCommandId } from "@read-aware/core";
import { createSettingsDomain, type SettingsDomain } from "../domain/settings/domain";
import { i18n } from "../i18n/instance";
import { createHostCommands } from "./host-commands";
import { workspace } from "./workspace";

export function hostCommandTitle(id: HostCommandId): string {
  const key = id === "go-shelf" ? "actions.goShelf.title" : id === "go-context" ? "actions.goAgent.title"
    : id === "go-stats" ? "actions.goStats.title" : id === "open-settings" ? "actions.openSettings.title"
      : id === "select" ? "actions.select.title" : id.startsWith("layout-") ? `layout.${id.slice(7)}`
        : id.startsWith("sort-") ? `sort.by.${id.slice(5)}` : id === "group-none" ? "group.none" : `group.by.${id.slice(6)}`;
  return i18n.t(key, { ns: "command", defaultValue: id });
}

export function actorHostCommands(settings: SettingsDomain, canReadWorkspace: boolean, canNavigate: boolean, canCloseReader: boolean) {
  return createHostCommands({ workspace, settings, canReadWorkspace, canNavigate, canCloseReader, title: hostCommandTitle });
}
export function trustedHostCommands(origin: EventOrigin) {
  return actorHostCommands(createSettingsDomain(origin), true, true, true);
}
