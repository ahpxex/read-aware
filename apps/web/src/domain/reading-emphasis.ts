import { ReadingEmphasisController } from "./reading-emphasis-controller";
import { readingRuntime } from "./reading-runtime";
import { createLogger } from "../platform/logger";

const log = createLogger("reading-emphasis");
export const readingEmphasis = new ReadingEmphasisController(readingRuntime, error => log.warn("Temporary emphasis failed", error));
export const agentEmphasisOwner = {};
