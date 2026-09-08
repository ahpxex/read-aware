import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import type { PluginDisposable, PluginManifest } from "@read-aware/plugin-types";
import { createLibraryDomain } from "../../../../domain/library";
import { invoke } from "../../../../platform/ipc";
import { localKV } from "../../../../platform/local-store";
import { pluginCommandsAtom } from "../../state/plugin-store";
import { inspectContributions } from "../../state/contribution-registry";
import { startPluginWorker } from "../plugin-worker-host";
import { buildReaderTools } from "../../../../../../../packages/agent/src/tools/reader-tools";
import { buildRuntimeDeps } from "../../../ai/agent/ports";

async function assertIsolated(): Promise<string> {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw new Error("Reading probes require isolated capability-e2e data");
  return path;
}

/** Real native import of deterministic, non-user content. No fake reader/storage. */
export async function importReadingProbeBook() {
  await assertIsolated();
  const sections = ["Alpha", "Beta", "Gamma"].map((title, index) => `<section id="chapter-${index}"><title><p>${title}</p></title>${Array.from({ length: 40 }, (_, paragraph) => `<p>${title} paragraph ${paragraph + 1}. The reader follows a precise location, checks a chapter, and returns to the previous passage. This text is deterministic test content, not a user's book.</p>`).join("")}</section>`).join("");
  const source = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>science</genre><author><first-name>ReadAware</first-name><last-name>Tests</last-name></author><book-title>Reading Capability Probe</book-title><lang>en</lang></title-info><document-info><author><nickname>ReadAware</nickname></author><date>2026-09-08</date><id>reading-capability-probe-v1</id><version>1.0</version></document-info></description><body>${sections}</body></FictionBook>`;
  return createLibraryDomain("user").commands.books.importBook({ fileName: "reading-capability-probe.fb2", data: new TextEncoder().encode(source) });
}

export async function runDesktopReadingProbe(bookId: string, readOnly = false) {
  const dataDir = await assertIsolated();
  const id = "capability-reading-probe";
  const prefix = `read-aware-plugin.${id}.`;
  await localKV.setItemAsync(prefix + "bookId", JSON.stringify(bookId));
  const manifest: PluginManifest = {
    id, name: "Reading capability probe", version: "1.0.0", schemaVersion: 1,
    description: readOnly ? "read-only" : "write",
    permissions: [readOnly ? "reading:read" : "reading:write"], requires: { domains: { reading: "^2.0.0" }, services: { storage: "^2.0.0" } },
  };
  const disposables: PluginDisposable[] = [];
  const worker = await startPluginWorker(manifest, "0.5.4", disposables, { moduleUrl: new URL("./reading-probe.ts", import.meta.url).href });
  try {
    await worker.checkHealth(); worker.promote();
    const command = getDefaultStore().get(pluginCommandsAtom).find(command => command.pluginId === id);
    if (!command) throw new Error("Reading probe command did not register");
    await command.run();
    const disk = await invoke<Record<string, string>>("load_kv_all");
    return { dataDir, result: JSON.parse(disk[prefix + "result"] ?? "null") as unknown };
  } finally {
    try { await worker.terminate(); }
    finally { for (const disposable of disposables.reverse()) disposable.dispose(); }
    if (inspectContributions(id).length) throw new Error("Reading probe left contributions behind");
  }
}

export async function runDesktopAgentReadingProbe(bookId: string) {
  await assertIsolated();
  const deps = buildRuntimeDeps();
  const tools = buildReaderTools({ kind: "book", bookId }, deps);
  const call = async (name: string, parameters: Record<string, unknown>) => {
    const result = await tools.find(tool => tool.name === name)!.execute("reading-e2e", parameters);
    if (result.content[0]?.type !== "text") throw new Error("Expected a reading tool text result");
    return JSON.parse(result.content[0].text) as unknown;
  };
  const opened = await call("open_book", { fraction: 0.45 });
  const current = await call("get_reading_session", {});
  const close = await call("navigate_reading", { action: "close" });
  return { opened, current, close, afterClose: await deps.reader.getSession() };
}

export async function importReadingProbePdf() {
  await assertIsolated();
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle("Reading Paint Probe");
  pdf.setCreationDate(new Date("2026-09-08T00:00:00Z"));
  pdf.setModificationDate(new Date("2026-09-08T00:00:00Z"));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= 4; index++) {
    const page = pdf.addPage([600, 800]);
    page.drawText(`Reading paint probe - page ${index}`, { font, size: 24, x: 45, y: 735 });
    for (let row = 0; row < 18; row++) page.drawText(`Page ${index}, line ${row + 1}: navigation must wait for this page.`, { font, size: 15, x: 45, y: 680 - row * 30 });
  }
  return createLibraryDomain("user").commands.books.importBook({ fileName: "reading-paint-probe.pdf", data: await pdf.save() });
}
