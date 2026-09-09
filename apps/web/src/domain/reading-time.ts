import { normalizeReadingTimeQuery, type ReadingTimeQuery, type ReadingTimeSnapshot } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { createLogger } from "../platform/logger";
import { ReadingTimeObserver } from "./reading-time-observer";

export function queryReadingTime(query: ReadingTimeQuery = {}): Promise<ReadingTimeSnapshot> {
  return invoke("reading_time_snapshot", { query: normalizeReadingTimeQuery(query) });
}

const log = createLogger("reading-time-observer");
export const readingTimeObserver = new ReadingTimeObserver({
  read: queryReadingTime,
  schedule: callback => { const timer = setTimeout(callback, 1000); return () => clearTimeout(timer); },
  report: error => log.warn("Reading time observation failed", error),
});
