import type { ReaderPort } from "@read-aware/agent";
import { createReadingDomain } from "../../../../domain/reading";
import { readerPanels } from "../../../../services/reader-panels";
import { readerFocus } from "../../../../services/reader-focus";
import { readerImage } from "../../../../services/reader-image";
import { readerImageOpen } from "../../../../services/reader-image-open";
import { readBookImage } from "../../../library/lib/book-images";
import { chapterHrefsThrough } from "../../../../domain/library";
import { readerReferencePreview } from "../../../../services/reader-reference-preview";
import { createBookTextPort } from "./book-text-port";
import { readingRuntime } from "../../../../domain/reading-runtime";

/** The model and plugins consume the same host-owned reading controller. */
export function createReaderPort(): ReaderPort {
  const reading = createReadingDomain("agent");
  const bookText = createBookTextPort();
  return {
    getSession: reading.queries.session,
    ...reading.commands,
    toolContext: () => {
      const session = readingRuntime.snapshot();
      return {
        bookId: session.bookId,
        session: !!session.sessionId,
        ready: session.status === "ready",
        selection: !!session.selection,
        controls: !!session.controls,
        panels: !!readerPanels.snapshot(),
        modes: session.mode.availableModes.length > 0 || session.mode.requestedActive,
        playback: session.playback.status !== "unavailable",
        imageBookId: readerImage.snapshot()?.bookId ?? null,
      };
    },
    getImage: async () => readerImage.snapshot(),
    openImage: ({ throughChapterIndex, ...query }, signal, guard) =>
      readerImageOpen.open(
        query,
        async (input, requestSignal, origin) => {
          const hrefs = await chapterHrefsThrough(input.image.bookId, throughChapterIndex, origin);
          return readBookImage(input, requestSignal, hrefs);
        },
        signal,
        guard,
        "agent",
      ),
    controlImage: (request, signal) => readerImage.control(request, signal, "agent"),
    previewReference: (ownerKey, { throughChapterIndex, ...query }, signal, guard) =>
      readerReferencePreview.open(
        `agent:${ownerKey}`,
        query,
        (input, requestSignal) => bookText.readReference({ ...input, throughChapterIndex }, requestSignal),
        signal,
        guard,
      ),
    closeReferencePreview: (ownerKey, id, signal) => readerReferencePreview.close(`agent:${ownerKey}`, id, signal),
    listEmphasis: reading.queries.emphasis,
    getPanels: async () => readerPanels.snapshot(),
    focus: (target, signal, guard) => readerFocus.focus(target, signal, guard, "agent"),
    setPanel: (panel, open, signal, guard) => readerPanels.setPanel(panel, open, signal, guard, "agent"),
    setPanelWidth: (panel, width, signal, guard) => readerPanels.setWidth(panel, width, signal, guard, "agent"),
  };
}
