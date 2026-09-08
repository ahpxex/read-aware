import { appDataDir } from "@tauri-apps/api/path";
import { createAnnotationsDomain } from "../../../../domain/annotations";
import { createLibraryDomain } from "../../../../domain/library";

const owned = new Map<string, "note" | "highlight">();
const domain = createAnnotationsDomain("agent");
async function assertIsolated() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw new Error("Use isolated capability-e2e data");
  return path;
}

export async function seedAnnotationDesk(bookId: string) {
  const dataDir = await assertIsolated();
  if (owned.size) throw new Error("Clean up the existing fixture before seeding again");
  if (!(await createLibraryDomain("agent").queries.books.get(bookId))) throw new Error("Fixture book missing");
  for (let index = 0; index < 23; index++) {
    const note = await domain.commands.createNote({ bookId, body: `Desk E2E note ${String(index).padStart(2, "0")}\n中文 annotation \"quoted\", line two`, quotedText: "Reading Capability Probe" });
    owned.set(note.id, "note");
  }
  for (let index = 0; index < 2; index++) {
    const highlight = await domain.commands.createHighlight({ bookId, text: `Desk E2E highlight ${index}`, color: "yellow" });
    owned.set(highlight.id, "highlight");
  }
  return { dataDir, created: [...owned] };
}

export async function inspectAnnotationDesk() {
  await assertIsolated();
  const items = [];
  for (const id of owned.keys()) items.push({ id, snapshot: await domain.queries.inspect(id) });
  return items;
}

/** Reattach only explicitly recorded fixture IDs after a development reload. */
export async function recoverAnnotationDesk(bookId: string, ids: string[]) {
  await assertIsolated();
  for (const id of ids) {
    const current = await domain.queries.inspect(id);
    if (!current) continue;
    const item = current.annotation;
    if (item.bookId !== bookId || item.kind === "ask" || !(item.kind === "note" ? item.body : item.text).startsWith("Desk E2E ")) {
      throw new Error("Fixture identity mismatch");
    }
    owned.set(id, item.kind);
  }
  return { recovered: owned.size };
}

export async function changeDeskNote(id: string) {
  await assertIsolated();
  if (owned.get(id) !== "note") throw new Error("Only fixture notes may be changed");
  await domain.commands.updateNote(id, "Desk E2E concurrent actor change");
  return domain.queries.inspect(id);
}

export async function cleanupAnnotationDesk() {
  await assertIsolated();
  for (const [id, kind] of owned) {
    const current = await domain.queries.inspect(id);
    if (current) await domain.commands.applyChanges([{ op: "remove", annotationId: id, kind, expectedRevision: current.revision }]);
    owned.delete(id);
  }
  return { remainingOwned: owned.size };
}
