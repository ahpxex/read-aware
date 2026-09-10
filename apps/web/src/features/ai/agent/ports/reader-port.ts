import type { ReaderPort } from "@read-aware/agent";
import { createReadingDomain } from "../../../../domain/reading";
import { readerPanels } from "../../../../services/reader-panels";
import { readerFocus } from "../../../../services/reader-focus";
import { readerImage } from "../../../../services/reader-image";
import { readerImageOpen } from "../../../../services/reader-image-open";
import { readBookImage } from "../../../library/lib/book-images";
import { getExtractedChapters } from "../../../../domain";
import { readerReferencePreview } from "../../../../services/reader-reference-preview";
import { createBookTextPort } from "./book-text-port";

/** The model and plugins consume the same host-owned reading controller. */
export function createReaderPort(): ReaderPort {
  const reading = createReadingDomain("agent");
  const bookText = createBookTextPort();
  return { getSession: reading.queries.session, ...reading.commands,
    getImage: async () => readerImage.snapshot(),
    openImage: ({ throughChapterIndex, ...query }, signal, guard) => readerImageOpen.open(query, async (input, requestSignal) => {
      const hrefs = throughChapterIndex === undefined ? undefined : (await getExtractedChapters(input.image.bookId))
        .slice(0, Math.max(0, throughChapterIndex + 1)).flatMap(chapter => chapter.hrefs ?? []);
      return readBookImage(input, requestSignal, hrefs);
    }, signal, guard),
    controlImage: (request, signal) => readerImage.control(request, signal),
    previewReference: (ownerKey, { throughChapterIndex, ...query }, signal, guard) => readerReferencePreview.open(`agent:${ownerKey}`, query,
      (input, requestSignal) => bookText.readReference({ ...input, throughChapterIndex }, requestSignal), signal, guard),
    closeReferencePreview: (ownerKey, id, signal) => readerReferencePreview.close(`agent:${ownerKey}`, id, signal),
    listEmphasis: reading.queries.emphasis,
    getPanels: async () => readerPanels.snapshot(),
    focus: (target, signal, guard) => readerFocus.focus(target, signal, guard),
    setPanel: (panel, open, signal, guard) => readerPanels.setPanel(panel, open, signal, guard),
    setPanelWidth: (panel, width, signal, guard) => readerPanels.setWidth(panel, width, signal, guard),
  };
}
