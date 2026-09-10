import { verifyProjectionReport } from "../platform/projection-verification";
import { isTauri } from "../platform/environment";
import { createLogger } from "../platform/logger";
import { HostDiagnosticsService } from "./diagnostics-controller";
import { AppError, type DiagnosticsReportAction } from "@read-aware/core";
import { HostActionFlow } from "./host-action-flow";
import { workspace } from "./workspace";

const log = createLogger("diagnostics-service");
export const hostDiagnosticsFlows = new HostActionFlow<{ action: DiagnosticsReportAction }, "exported" | "sent">({
  navigate: signal => workspace.navigate({ surface: "settings", section: "about" }, undefined, signal),
  normalize: input => {
    if (!input || !["export", "send"].includes(input.action)) throw new AppError("ui/invalid-target", "Invalid diagnostic report action");
    return { action: input.action };
  },
  completion: (action, value) => action === "send" ? "sent" : value === true ? "exported" : "cancelled",
});
export const hostDiagnostics = new HostDiagnosticsService({
  supported: isTauri,
  verify: verifyProjectionReport,
  requestReport: (action, signal) => hostDiagnosticsFlows.request({ action }, signal),
}, error => log.warn("Diagnostic operation failed", error));
