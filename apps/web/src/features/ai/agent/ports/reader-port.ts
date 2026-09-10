import type { ReaderPort } from "@read-aware/agent";
import { createReadingDomain } from "../../../../domain/reading";
import { readerPanels } from "../../../../services/reader-panels";
import { readerReferencePreview } from "../../../../services/reader-reference-preview";
import { createBookTextPort } from "./book-text-port";

/** The model and plugins consume the same host-owned reading controller. */
export function createReaderPort(): ReaderPort {
  const reading = createReadingDomain("agent");
  const bookText = createBookTextPort();
  return { getSession: reading.queries.session, ...reading.commands,
    previewReference: (ownerKey, { throughChapterIndex, ...query }, signal, guard) => readerReferencePreview.open(`agent:${ownerKey}`, query,
      (input, requestSignal) => bookText.readReference({ ...input, throughChapterIndex }, requestSignal), signal, guard),
    closeReferencePreview: (ownerKey, id, signal) => readerReferencePreview.close(`agent:${ownerKey}`, id, signal),
    listEmphasis: reading.queries.emphasis,
    getPanels: async () => readerPanels.snapshot(),
    setPanel: (panel, open, signal, guard) => readerPanels.setPanel(panel, open, signal, guard),
  };
}
