/**
 * Internal shelf drag protocol. Book cards start HTML5 drags carrying their
 * book ids under a custom MIME type so drop targets (collection tiles, the
 * drag action dock) can tell an in-app book drag apart from an OS file drop —
 * and so the window-level import listener can ignore it (WebKit tags a native
 * image drag with "Files" too, which used to summon the import overlay).
 */
export const BOOK_DRAG_TYPE = "application/x-readaware-books";

export function setBookDragPayload(dataTransfer: DataTransfer, ids: string[]): void {
  dataTransfer.setData(BOOK_DRAG_TYPE, JSON.stringify(ids));
}

/** Type membership is readable during dragover; the payload itself only on drop. */
export function dragCarriesBooks(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer?.types.includes(BOOK_DRAG_TYPE) ?? false;
}

export function readBookDragPayload(dataTransfer: DataTransfer | null): string[] {
  const raw = dataTransfer?.getData(BOOK_DRAG_TYPE);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    // The payload can only come from this app's own dragstart; a malformed
    // one means the drag carries nothing actionable.
    return [];
  }
}
