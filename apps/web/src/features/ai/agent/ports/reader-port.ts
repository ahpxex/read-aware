import type { ReaderPort } from "@read-aware/agent";
import { createReadingDomain } from "../../../../domain/reading";
import { readerPanels } from "../../../../services/reader-panels";

/** The model and plugins consume the same host-owned reading controller. */
export function createReaderPort(): ReaderPort {
  const reading = createReadingDomain("agent");
  return { getSession: reading.queries.session, ...reading.commands,
    getPanels: async () => readerPanels.snapshot(),
    setPanel: (panel, open, signal, guard) => readerPanels.setPanel(panel, open, signal, guard),
  };
}
