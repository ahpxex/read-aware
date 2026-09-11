import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { createAnnotationsDomain } from "../../src/domain/annotations";
import { readingRuntime } from "../../src/domain/reading-runtime";
import { runPluginContribution } from "../../src/features/plugins/lib/run-result";
import { installedPluginsAtom, pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { setPluginEnabled } from "../../src/features/plugins/runtime/plugin-host";
import { cleanupLibraryContent, prepareLibraryContent } from "./desktop-library-content";

let bookId: string | undefined;
let wasEnabled: boolean | undefined;
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) {
    throw Error("Requires isolated capability-e2e profile");
  }
}
export async function prepareAnnotationComposition() {
  await isolated();
  if (bookId || wasEnabled !== undefined) throw Error("Composition already prepared");
  const plugin = getDefaultStore().get(installedPluginsAtom).find(item => item.manifest.id === "annotation-desk");
  if (!plugin?.builtin) throw Error("Expected RepoDist Annotation Desk");
  wasEnabled = plugin.enabled;
  if (!plugin.enabled) await setPluginEnabled("annotation-desk", true);
  const prepared = await prepareLibraryContent();
  bookId = prepared.bookId;
  return { ...prepared, annotationVersion: plugin.manifest.version };
}
export async function openAnnotationComposition(id: "annotation-desk" | "text-desk") {
  await isolated();
  if (!bookId) throw Error("Prepare composition first");
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === id && item.id === "open");
  if (!command) throw Error("Registered command missing");
  await runPluginContribution(id, id, () => command.run(), { presentation: "dialog", owner: command.run });
}
export async function inspectAnnotationComposition() {
  await isolated();
  if (!bookId) throw Error("Prepare composition first");
  const session = readingRuntime.snapshot();
  return { bookId, session,
    annotations: await createAnnotationsDomain("user").queries.page({ bookId, limit: 20 }),
    plugins: getDefaultStore().get(installedPluginsAtom)
      .filter(item => ["annotation-desk", "text-desk"].includes(item.manifest.id))
      .map(item => ({ id: item.manifest.id, version: item.manifest.version, enabled: item.enabled, error: item.error })) };
}
export async function cleanupAnnotationComposition() {
  await isolated();
  const session = readingRuntime.snapshot();
  if (session.bookId === bookId && session.sessionId) await readingRuntime.close(undefined, { bookId, sessionId: session.sessionId });
  const result = await cleanupLibraryContent();
  if (wasEnabled === false) await setPluginEnabled("annotation-desk", false);
  bookId = undefined; wasEnabled = undefined;
  return result;
}
