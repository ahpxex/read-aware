import type { EventOrigin, HostCommandId, HostCommandObservation } from "@read-aware/core";
import { createSettingsDomain, type SettingsDomain } from "../domain/settings/domain";
import { i18n } from "../i18n/instance";
import { createHostCommands } from "./host-commands";
import { workspace } from "./workspace";
import { readingRuntime } from "../domain/reading-runtime";
import { HostCommandObservers } from "./host-command-observers";
import { createLogger } from "../platform/logger";

const log = createLogger("host-commands");
const observers = new HostCommandObservers(error => log.warn("Command observation failed", error));

export function hostCommandTitle(id: HostCommandId): string {
  const key = id === "open-book" ? "actions.openBook.title" : id === "open-collection" ? "actions.openCollection.title"
    : id === "go-shelf" ? "actions.goShelf.title" : id === "go-context" ? "actions.goAgent.title"
    : id === "go-stats" ? "actions.goStats.title" : id === "open-settings" ? "actions.openSettings.title"
      : id === "select" ? "actions.select.title" : id.startsWith("layout-") ? `layout.${id.slice(7)}`
        : id.startsWith("sort-") ? `sort.by.${id.slice(5)}` : id === "group-none" ? "group.none" : `group.by.${id.slice(6)}`;
  return i18n.t(key, { ns: "command", defaultValue: id });
}

export function actorHostCommands(settings: SettingsDomain, canReadWorkspace: boolean, canNavigate: boolean, canCloseReader: boolean) {
  const commands = createHostCommands({ workspace, settings, canReadWorkspace, canNavigate, canCloseReader, title: hostCommandTitle,
    openBook: (bookId, signal) => readingRuntime.navigate({ bookId }, signal) });
  return { ...commands, observe: (handler: (state: HostCommandObservation) => unknown) => observers.observe(commands.list, invalidate => {
    const releases: (() => void)[] = [];
    const release = () => { for (const dispose of releases.splice(0).reverse()) dispose(); };
    try {
      if (canReadWorkspace) releases.push(workspace.observe({ limit: 1 }, invalidate));
      releases.push(settings.queries.observe({ section: "shelf" }, invalidate));
      i18n.on("languageChanged", invalidate);
      releases.push(() => { i18n.off("languageChanged", invalidate); });
      return release;
    } catch (error) { release(); throw error; }
  }, handler) };
}
export function trustedHostCommands(origin: EventOrigin) {
  return actorHostCommands(createSettingsDomain(origin), true, true, true);
}
