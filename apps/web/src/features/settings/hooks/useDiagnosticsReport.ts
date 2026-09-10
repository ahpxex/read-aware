import { useLayoutEffect, useRef, useState } from "react";
import { AppError, type DiagnosticsReportAction } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { hostDiagnosticsFlows } from "../../../services/diagnostics";
import { assembleDiagnosticsBundle, exportDiagnosticsBundle, sendDiagnosticsReport, type DiagnosticsBundle } from "../lib/diagnostics";

type Report =
  | { action: DiagnosticsReportAction; step: "assembling" }
  | { action: DiagnosticsReportAction; step: "preview" | "working"; bundle: DiagnosticsBundle }
  | { action: "send"; step: "sent"; reportId: string };
const log = createLogger("diagnostics");

/** Both native buttons and actor requests use the same preview and confirmation.
 * Bundle bytes and server receipts stay in this host-owned hook. */
export function useDiagnosticsReport() {
  const { t } = useTranslation("settings");
  const { toast } = useToast();
  const [report, setReport] = useState<Report | null>(null);
  const current = useRef<Report | null>(null), generation = useRef(0);
  const publish = (value: Report | null) => { current.current = value; setReport(value); };
  const reset = () => { generation.current++; publish(null); };
  const failure = (error: unknown, action: DiagnosticsReportAction) => {
    log.error(`diagnostics ${action} failed`, error);
    toast({ variant: "destructive", title: t("about.diagnostics.noticeError"),
      description: t(action === "export" ? "about.diagnostics.exportError" : "about.diagnostics.reportError") });
  };
  const open = (action: DiagnosticsReportAction, signal?: AbortSignal) => {
    if (current.current) throw new AppError("ui/unavailable", "A native diagnostic dialog is already active");
    signal?.throwIfAborted();
    const ticket = ++generation.current;
    publish({ action, step: "assembling" });
    void (async () => {
      try {
        const bundle = await assembleDiagnosticsBundle();
        if (ticket !== generation.current || signal?.aborted) return;
        publish({ action, step: "preview", bundle });
      } catch (error) {
        if (ticket !== generation.current) { log.warn("Abandoned diagnostics assembly failed", error); return; }
        hostDiagnosticsFlows.reject(action, error); reset(); failure(error, action);
      }
    })();
  };
  const latest = useRef({ open, reset }); latest.current = { open, reset };
  useLayoutEffect(() => {
    const off = hostDiagnosticsFlows.bind({ open: ({ action }, signal) => latest.current.open(action, signal), close: () => latest.current.reset() });
    return () => { generation.current++; off(); };
  }, []);

  const close = () => {
    const value = current.current;
    if (!value || value.step === "working") return;
    hostDiagnosticsFlows.dismiss(value.action); reset();
  };
  const confirm = async () => {
    const value = current.current;
    if (!value || value.step !== "preview") return;
    const ticket = generation.current;
    publish({ ...value, step: "working" });
    try {
      const result = await hostDiagnosticsFlows.run<boolean | string>(value.action, () => value.action === "export"
        ? exportDiagnosticsBundle(value.bundle) : sendDiagnosticsReport(value.bundle));
      if (ticket !== generation.current) return;
      if (value.action === "send") publish({ action: "send", step: "sent", reportId: result as string });
      else {
        reset();
        if (result === true) toast({ variant: "success", title: t("about.diagnostics.noticeDone"), description: t("about.diagnostics.exportSuccess") });
      }
    } catch (error) {
      if (ticket !== generation.current) { log.warn("Abandoned diagnostic action failed", error); return; }
      publish({ ...value, step: "preview" }); failure(error, value.action);
    }
  };
  return { report, close, confirm, open: (action: DiagnosticsReportAction) => {
    try { open(action); } catch (error) { failure(error, action); }
  } };
}
