import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { readerPanels } from "../../../../services/reader-panels";
import { readingRuntime } from "../../../../domain/reading-runtime";
import { installedPluginsAtom, pluginCommandsAtom } from "../../state/plugin-store";
import { setPluginEnabled } from "../plugin-host";
import { runPluginContribution } from "../../lib/run-result";

let original: { enabled: boolean; bookId: string; widths: { toc: number; chat: number } } | undefined;
async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Requires isolated capability-e2e profile");
}
export async function prepareListeningComposition(bookId: string) {
  await isolated();
  const plugin = getDefaultStore().get(installedPluginsAtom).find(item => item.manifest.id === "listening-desk");
  const panels = readerPanels.snapshot();
  if (original || !plugin?.builtin || !panels || panels.bookId !== bookId) throw Error("Requires an unclaimed ready test book and RepoDist plugin");
  original = { enabled: plugin.enabled, bookId, widths: { ...panels.sizes } };
  if (!plugin.enabled) await setPluginEnabled("listening-desk", true);
  return { version: plugin.manifest.version, ...original };
}
export async function openListeningComposition() {
  await isolated();
  if (!original) throw Error("Prepare the composition first");
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === "listening-desk" && item.id === "open");
  if (!command) throw Error("Listening Desk command unavailable");
  await runPluginContribution("listening-desk", "Listening Desk", () => command.run(), { presentation: "dialog", owner: command.run });
}
export async function inspectListeningComposition() {
  await isolated();
  const state = readingRuntime.snapshot();
  return { status: state.status, bookId: state.bookId, playback: state.playback, mode: state.mode, panels: readerPanels.snapshot() };
}
export async function cleanupListeningComposition() {
  await isolated();
  if (!original) return;
  const state = readingRuntime.snapshot();
  if (state.status !== "ready" || state.bookId !== original.bookId) throw Error("Reopen owned test book before restoring widths");
  const guard = { bookId: original.bookId, sessionId: state.sessionId! };
  await readerPanels.setWidth("toc", original.widths.toc, undefined, guard);
  await readerPanels.setWidth("chat", original.widths.chat, undefined, guard);
  await setPluginEnabled("listening-desk", false);
  if (original.enabled) await setPluginEnabled("listening-desk", true);
  original = undefined;
  return { panels: readerPanels.snapshot(), restored: true };
}
