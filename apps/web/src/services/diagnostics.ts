import { verifyProjectionReport } from "../platform/projection-verification";
import { isTauri } from "../platform/environment";
import { createLogger } from "../platform/logger";
import { HostDiagnosticsService } from "./diagnostics-controller";

const log = createLogger("diagnostics-service");
export const hostDiagnostics = new HostDiagnosticsService({
  supported: isTauri,
  verify: verifyProjectionReport,
}, error => log.warn("Projection verification failed", error));
