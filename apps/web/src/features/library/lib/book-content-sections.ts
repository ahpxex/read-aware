import type { FoliateBook } from "../../reader/lib/foliate-engine";

/** Chapter extraction may retain either a resolved href or a canonical spine id. */
export async function contentSections(book: FoliateBook, hrefs: readonly string[] | undefined, signal?: AbortSignal): Promise<Set<number>> {
  const indices = new Set<number>();
  if (hrefs === undefined) {
    book.sections.forEach((section, index) => { if (section.linear !== "no") indices.add(index); });
  } else for (const href of hrefs) {
    signal?.throwIfAborted();
    const resolved = await book.resolveHref?.(href);
    if (resolved && Number.isInteger(resolved.index) && book.sections[resolved.index]) indices.add(resolved.index);
    const index = book.sections.findIndex(section => section.id === href);
    if (index >= 0) indices.add(index);
  }
  signal?.throwIfAborted();
  return indices;
}
