import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { createLibraryDomain } from "../../../../domain/library";
import { installedPluginsAtom, pluginCommandsAtom } from "../../state/plugin-store";
import { runPluginContribution } from "../../lib/run-result";
import { setPluginEnabled } from "../plugin-host";

const plugins = ["library-desk", "text-desk"] as const;
const enabled = new Map<string, boolean>();
let bookId: string | undefined;
let marker: string | undefined;

async function isolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Requires isolated capability-e2e profile");
  return path;
}

export async function prepareLibraryContent() {
  const path = await isolated();
  if (marker || enabled.size) throw Error("Acceptance already owns resources");
  marker = `Composition ${crypto.randomUUID().slice(0, 8)}`;
  for (const id of plugins) {
    const installed = getDefaultStore().get(installedPluginsAtom).find(plugin => plugin.manifest.id === id);
    if (!installed?.builtin) throw Error(`Expected debug RepoDist ${id}`);
    enabled.set(id, installed.enabled);
    if (!installed.enabled) await setPluginEnabled(id, true);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 240; canvas.height = 160;
  const painter = canvas.getContext("2d")!;
  painter.fillStyle = "#e53935"; painter.fillRect(0, 0, 120, 160);
  painter.fillStyle = "#159447"; painter.fillRect(120, 0, 120, 160);
  painter.fillStyle = "#ffffff"; painter.fillRect(80, 50, 80, 60);
  const png = canvas.toDataURL("image/png").split(",")[1];
  const source = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>science</genre><author><first-name>Fixture</first-name><last-name>Author</last-name></author><book-title>${marker}</book-title><coverpage><image l:href="#picture"/></coverpage><lang>en</lang></title-info><document-info><author><nickname>ReadAware Tests</nickname></author><date>2026-09-11</date><id>${marker}</id><version>1.0</version></document-info></description>
<body><section id="first"><title><p>Illustrated section</p></title><p>Deterministic acceptance content with a note <a l:href="#note-one" type="note">1</a>.</p><image l:href="#picture"/><p>Red left, green right, white center.</p></section><section id="second"><title><p>Second section</p></title><p>A second source section for navigation.</p></section></body>
<body name="notes"><section id="note-one"><title><p>1</p></title><p>Acceptance footnote: the source is a local test book.</p></section></body><binary id="picture" content-type="image/png">${png}</binary></FictionBook>`;
  const book = await createLibraryDomain("user").commands.books.importBook({ fileName: `${marker}.fb2`, data: new TextEncoder().encode(source) });
  bookId = book.id;
  return { path, marker, bookId, plugins: getDefaultStore().get(installedPluginsAtom).filter(plugin => plugins.includes(plugin.manifest.id as typeof plugins[number]))
    .map(plugin => ({ id: plugin.manifest.id, version: plugin.manifest.version, enabled: plugin.enabled, error: plugin.error })) };
}

export async function openLibraryContent(id: typeof plugins[number]) {
  await isolated();
  if (!enabled.has(id)) throw Error("Plugin not owned by acceptance");
  const command = getDefaultStore().get(pluginCommandsAtom).find(item => item.pluginId === id && item.id === "open");
  if (!command) throw Error("Plugin command unavailable");
  await runPluginContribution(id, id, () => command.run(), { presentation: "dialog", owner: command.run });
}

export async function inspectLibraryContent() {
  await isolated();
  const library = createLibraryDomain("user");
  return { marker, book: bookId ? await library.queries.books.get(bookId) : null,
    collections: (await library.queries.collections.list()).filter(collection => marker && collection.name.startsWith(marker)) };
}

export async function cleanupLibraryContent() {
  await isolated();
  for (const id of enabled.keys()) await setPluginEnabled(id, false);
  const library = createLibraryDomain("user");
  for (const collection of await library.queries.collections.list()) {
    if (marker && collection.name.startsWith(marker)) await library.commands.collections.remove(collection.id);
  }
  const removed = bookId ? await library.commands.books.removeMany([bookId]) : null;
  if (removed?.files.status === "pending") throw Error("Owned fixture file cleanup is pending");
  bookId = undefined;
  for (const [id, wasEnabled] of enabled) if (wasEnabled) await setPluginEnabled(id, true);
  enabled.clear(); marker = undefined;
  return { removed, remaining: (await library.queries.books.list()).map(book => ({ id: book.id, title: book.title })) };
}
