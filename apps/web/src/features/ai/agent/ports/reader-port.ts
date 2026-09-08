import type { ReaderPort } from "@read-aware/agent";
import { createReadingDomain } from "../../../../domain/reading";

/** The model and plugins consume the same host-owned reading controller. */
export function createReaderPort(): ReaderPort {
  const reading = createReadingDomain("agent");
  return { getSession: reading.queries.session, ...reading.commands };
}
