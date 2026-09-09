import { appDataDir } from "@tauri-apps/api/path";
import { changeBookClassification, inspectBookClassification } from "../../../../domain/book-classification";
import { createLibraryPort } from "../../../ai/agent/ports/library-port";
import { createLibraryDomain } from "../../../../domain/library";

export async function runClassificationStorageProbe() {
  const path = await appDataDir();
  if (!path.replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e data");
  const domain = createLibraryDomain("user"), library = createLibraryPort();
  const xml = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>science</genre><author><nickname>Tests</nickname></author><book-title>Classification probe ${crypto.randomUUID()}</book-title><lang>en</lang></title-info><document-info><author><nickname>Tests</nickname></author><date>2026-09-10</date><id>${crypto.randomUUID()}</id><version>1</version></document-info></description><body><section><title><p>One</p></title><p>Classification test source.</p></section></body></FictionBook>`;
  const { id: bookId } = await domain.commands.books.importBook({ fileName: "classification-probe.fb2", data: new TextEncoder().encode(xml) });
  try {
    const initial = (await inspectBookClassification(bookId))!;
    const first = await library.classifyBookIfUnclassified(bookId, "narrative");
    const classified = (await inspectBookClassification(bookId))!;
    const edited = await changeBookClassification({ bookId, narrativity: "expository", expectedRevision: classified.revision }, "user");
    const late = await library.classifyBookIfUnclassified(bookId, "narrative");
    const afterLate = (await inspectBookClassification(bookId))!;
    let conflict: string | undefined;
    try { await changeBookClassification({ bookId, narrativity: "narrative", expectedRevision: classified.revision }, "agent"); }
    catch (error) { conflict = (error as { code?: string }).code; }
    const cancelled = new AbortController(); cancelled.abort();
    let cancellation: string | undefined;
    try { await changeBookClassification({ bookId, narrativity: "narrative", expectedRevision: edited.snapshot.revision }, "user", cancelled.signal); }
    catch (error) { cancellation = (error as { code?: string }).code; }
    const final = (await inspectBookClassification(bookId))!;
    return { bookId, initial: initial.narrativity, automatic: first, edited: edited.snapshot.narrativity, late,
      lateDidNotWrite: afterLate.revision === edited.snapshot.revision, conflict, cancellation,
      final: final.narrativity, failedWritesDidNotChangeRevision: final.revision === afterLate.revision };
  } finally {
    await domain.commands.books.remove(bookId);
    if (await inspectBookClassification(bookId)) throw Error("Owned classification probe cleanup failed");
  }
}
