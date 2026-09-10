import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { createLibraryDomain } from "../../../../domain/library";
import { createConversationsDomain } from "../../../../domain/conversations";
import { readingRuntime } from "../../../../domain/reading-runtime";
import { readerImage } from "../../../../services/reader-image";
import { saveConversation, loadConversation } from "../../../ai/lib/conversation-store";
import { putStoredConversationInsights, clearStoredConversationInsights } from "../../../ai/lib/conversation-insights-store";
import { selectGlobalThread } from "../../../ai/state/global-thread";
import { installedPluginsAtom, pluginCommandsAtom } from "../../state/plugin-store";
import { runPluginContribution } from "../../lib/run-result";
import { setPluginEnabled } from "../plugin-host";

let bookId: string | undefined, threadId: string | undefined, previousThread: string | undefined;
const enabled = new Map<string, boolean>();
async function isolated() {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) {
    throw Error("Isolated capability-e2e profile required");
  }
}
export async function prepareImageConversationComposition(id: string) {
  await isolated();
  if (bookId) throw Error("Composition already prepared");
  const book = await createLibraryDomain("user").queries.books.get(id);
  if (!book?.title.startsWith("Composition ")) throw Error("Requires owned composition book");
  bookId = id;
  previousThread = (await createConversationsDomain("user").queries.runtime()).selectedGlobalThreadId;
  for (const id of ["text-desk", "memory-desk"]) {
    const plugin = getDefaultStore().get(installedPluginsAtom).find(item => item.manifest.id === id);
    if (!plugin?.builtin) throw Error("Requires RepoDist plugins");
    enabled.set(id, plugin.enabled);
    if (!plugin.enabled) await setPluginEnabled(id, true);
  }
  return inspectImageConversationComposition();
}
export async function openImageConversationCommand(id: "text-desk" | "memory-desk", commandId = "open") {
  await isolated();
  if (!enabled.has(id)) throw Error("Prepare composition first");
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === id && item.id === commandId);
  if (!command) throw Error("Registered command missing");
  await runPluginContribution(id, id, () => command.run(), { presentation: "dialog", owner: command.run });
}
export async function prepareOwnedConversation() {
  await isolated();
  if (!bookId || threadId) throw Error("Prepare once before creating a conversation");
  const receipt = await createConversationsDomain("user").commands.createThread();
  threadId = receipt.target.id;
  await saveConversation(threadId, [
    { id: crypto.randomUUID(), role: "user", content: "Composition conversation fe95514b", createdAt: new Date().toISOString() },
    { id: crypto.randomUUID(), role: "assistant", content: "Scripted fixture response, not model output.", createdAt: new Date().toISOString() },
  ]);
  await putStoredConversationInsights(`global:${threadId}`, "Composition summary fe95514b. ".repeat(180));
  return inspectImageConversationComposition();
}
export async function inspectImageConversationComposition() {
  await isolated();
  const domain = createConversationsDomain("plugin:memory-desk");
  const session = readingRuntime.snapshot();
  return { bookId, threadId, previousThread,
    reading: { status: session.status, bookId: session.bookId, sessionId: session.sessionId }, image: readerImage.snapshot(),
    runtime: await domain.queries.runtime(), requests: (await domain.queries.turnRequests()).filter(item => item.target.id === threadId),
    messages: threadId ? await loadConversation(threadId) : [],
    plugins: getDefaultStore().get(installedPluginsAtom).filter(item => enabled.has(item.manifest.id))
      .map(item => ({ id: item.manifest.id, version: item.manifest.version, enabled: item.enabled, error: item.error })) };
}
export async function cleanupImageConversationComposition() {
  await isolated();
  if (threadId) {
    await createConversationsDomain("user").commands.clear({ kind: "global", id: threadId });
    await clearStoredConversationInsights(`global:${threadId}`);
  }
  if (previousThread) await selectGlobalThread(previousThread);
  const reading = readingRuntime.snapshot();
  if (reading.bookId === bookId && reading.sessionId) await readingRuntime.close(undefined, { bookId, sessionId: reading.sessionId });
  const removed = bookId ? await createLibraryDomain("user").commands.books.removeMany([bookId]) : null;
  if (removed?.files.status === "pending") throw Error("Owned book file cleanup pending");
  for (const [id, wasEnabled] of enabled) if (!wasEnabled) await setPluginEnabled(id, false);
  const result = { state: await inspectImageConversationComposition(), removed,
    remainingBooks: (await createLibraryDomain("user").queries.books.list()).map(book => book.title) };
  bookId = undefined; threadId = undefined; previousThread = undefined; enabled.clear();
  return result;
}
