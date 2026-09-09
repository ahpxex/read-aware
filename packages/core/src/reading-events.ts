import type { DomainEventType } from "./events";

/** One roster for the host subscription gate and the public plugin type. */
export const READING_DOMAIN_EVENT_TYPES = [
  "book.opened", "book.finished", "book.progressed", "book.timeRecorded", "book.sessionRecorded",
] as const satisfies readonly DomainEventType[];
export type ReadingDomainEventType = (typeof READING_DOMAIN_EVENT_TYPES)[number];
