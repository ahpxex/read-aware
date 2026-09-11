import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { createLibraryDomain } from "../../src/domain/library";
import { readingRuntime } from "../../src/domain/reading-runtime";
import { runPluginContribution } from "../../src/features/plugins/lib/run-result";
import { installedPluginsAtom, pluginCommandsAtom } from "../../src/features/plugins/state/plugin-store";
import { pluginDocsGet, pluginDocsList } from "../../src/features/plugins/runtime/plugin-backend";
import { setPluginEnabled } from "../../src/features/plugins/runtime/plugin-host";

const url = "http://127.0.0.1:19846/feed.atom";
let wasEnabled: boolean | undefined, bookId: string | undefined;
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Isolated profile required");
}
export async function prepareRssComposition() {
  await isolated();
  if (wasEnabled !== undefined) throw Error("Already prepared");
  if ((await pluginDocsList("rss-reader", "feeds", { limit: 1 })).length) throw Error("Requires empty isolated RSS subscriptions");
  const plugin = getDefaultStore().get(installedPluginsAtom).find(item => item.manifest.id === "rss-reader");
  if (!plugin?.builtin) throw Error("Expected RepoDist RSS Reader");
  wasEnabled = plugin.enabled;
  if (!plugin.enabled) await setPluginEnabled("rss-reader", true);
  return { url, version: plugin.manifest.version, wasEnabled };
}
export async function openRssComposition() {
  await isolated();
  if (wasEnabled === undefined) throw Error("Prepare first");
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === "rss-reader" && item.id === "subscribe");
  if (!command) throw Error("Registered subscriptions command missing");
  await runPluginContribution("rss-reader", "RSS Reader", () => command.run(), { presentation: "dialog", owner: command.run });
}
export async function inspectRssComposition() {
  await isolated();
  const feed = await pluginDocsGet("rss-reader", "feeds", url);
  if (feed?.bookId) bookId = feed.bookId;
  const library = createLibraryDomain("user");
  return { url, bookId, feed, session: readingRuntime.snapshot(),
    source: bookId && await library.queries.books.get(bookId) ? await library.queries.books.getContentState(bookId) : null,
    content: bookId ? await pluginDocsList("rss-reader", "feed-content", { bookId, limit: 20 }) : [] };
}
export async function closeRssCompositionReader() {
  await isolated();
  const session = readingRuntime.snapshot();
  if (bookId && session.bookId === bookId && session.sessionId) await readingRuntime.close(undefined, { bookId, sessionId: session.sessionId });
}
export async function cycleRssCompositionWorker() {
  await isolated();
  if (wasEnabled === undefined) throw Error("Prepare first");
  await closeRssCompositionReader();
  await setPluginEnabled("rss-reader", false);
  await setPluginEnabled("rss-reader", true);
  return inspectRssComposition();
}
export async function cleanupRssComposition() {
  await isolated();
  await closeRssCompositionReader();
  const state = await inspectRssComposition();
  if (state.feed || state.source || state.content.length) throw Error("Unsubscribe the owned feed before cleanup");
  if (wasEnabled === false) await setPluginEnabled("rss-reader", false);
  const remaining = await createLibraryDomain("user").queries.books.list();
  wasEnabled = undefined; bookId = undefined;
  return { state, remaining: remaining.map(book => ({ id: book.id, title: book.title })) };
}
