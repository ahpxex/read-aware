import { accrueReadingSession, noteReadingPosition, listPendingReadingSessions, flushReadingSessions } from "../../../platform/reading-session";
import { createLogger } from "../../../platform/logger";
import { ReadingTraceCoordinator } from "./reading-trace";

const log = createLogger("reading-session");
export const readingTraces = new ReadingTraceCoordinator({
  accrue: accrueReadingSession,
  position: noteReadingPosition,
  pending: listPendingReadingSessions,
  flush: flushReadingSessions,
  report: error => log.error("reading trace persistence failed; close must not claim durability", error),
});
