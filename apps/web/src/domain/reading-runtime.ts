import { createLogger } from "../platform/logger";
import { ReadingSessionController } from "./reading-session-controller";

const log = createLogger("reader");
export const readingRuntime = new ReadingSessionController(error => log.warn("reading observer failed", error));
