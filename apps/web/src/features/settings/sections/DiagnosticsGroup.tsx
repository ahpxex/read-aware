/**
 * Settings → About → Diagnostics: export the diagnostics bundle to a file, or
 * send it to the developers through the relay — each behind an explicit user
 * action, the report additionally behind a preview-and-confirm dialog. The
 * app never uploads anything on its own; this group is the entire reporting
 * surface.
 */
import { useState } from "react";
import { Button, Dialog, Spinner, useToast } from "@read-aware/ui";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { isMobileOS, isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import { useTranslation } from "../../../i18n";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsRow } from "../components/SettingsRow";
import {
  assembleDiagnosticsBundle,
  diagnosticsLogDir,
  exportDiagnosticsBundle,
  sendDiagnosticsReport,
  type DiagnosticsBundle,
} from "../lib/diagnostics";

const log = createLogger("diagnostics");

type ReportPhase =
  | { step: "preview"; bundle: DiagnosticsBundle }
  | { step: "sending"; bundle: DiagnosticsBundle }
  | { step: "sent"; reportId: string };

export function DiagnosticsGroup() {
  const { t } = useTranslation("settings");
  const { toast } = useToast();
  const [assembling, setAssembling] = useState<"export" | "report" | null>(null);
  const [report, setReport] = useState<ReportPhase | null>(null);

  const failureToast = (error: unknown, what: "export" | "report") => {
    log.error(`diagnostics ${what} failed`, error);
    toast({
      variant: "destructive",
      title: t("about.diagnostics.noticeError"),
      description:
        what === "export" ? t("about.diagnostics.exportError") : t("about.diagnostics.reportError"),
    });
  };

  const handleExport = async () => {
    setAssembling("export");
    try {
      const bundle = await assembleDiagnosticsBundle();
      if (await exportDiagnosticsBundle(bundle)) {
        toast({
          variant: "success",
          title: t("about.diagnostics.noticeDone"),
          description: t("about.diagnostics.exportSuccess"),
        });
      }
    } catch (error) {
      failureToast(error, "export");
    } finally {
      setAssembling(null);
    }
  };

  const handleOpenReport = async () => {
    setAssembling("report");
    try {
      setReport({ step: "preview", bundle: await assembleDiagnosticsBundle() });
    } catch (error) {
      failureToast(error, "report");
    } finally {
      setAssembling(null);
    }
  };

  const handleSend = async (bundle: DiagnosticsBundle) => {
    setReport({ step: "sending", bundle });
    try {
      setReport({ step: "sent", reportId: await sendDiagnosticsReport(bundle) });
    } catch (error) {
      failureToast(error, "report");
      setReport({ step: "preview", bundle });
    }
  };

  const handleRevealLogs = async () => {
    try {
      await revealItemInDir(await diagnosticsLogDir());
    } catch (error) {
      log.error("revealing the log folder failed", error);
    }
  };

  const dialogOpen = report !== null;
  const closeDialog = () => {
    if (report?.step === "sending") return;
    setReport(null);
  };

  return (
    <>
      <SettingsGroup
        title={t("about.diagnostics.title")}
        description={t("about.diagnostics.description")}
      >
        <SettingsRow
          borderless
          title={t("about.diagnostics.exportRow.title")}
          description={t("about.diagnostics.exportRow.description")}
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={assembling !== null}
              onClick={() => void handleExport()}
            >
              {assembling === "export" && <Spinner size="sm" />}
              {t("about.diagnostics.exportRow.button")}
            </Button>
          }
        />
        <SettingsRow
          title={t("about.diagnostics.reportRow.title")}
          description={t("about.diagnostics.reportRow.description")}
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={assembling !== null}
              onClick={() => void handleOpenReport()}
            >
              {assembling === "report" && <Spinner size="sm" />}
              {t("about.diagnostics.reportRow.button")}
            </Button>
          }
        />
        {isTauri() && !isMobileOS() && (
          <SettingsRow
            title={t("about.diagnostics.logsRow.title")}
            description={t("about.diagnostics.logsRow.description")}
            control={
              <Button variant="outline" size="sm" onClick={() => void handleRevealLogs()}>
                {t("about.diagnostics.logsRow.button")}
              </Button>
            }
          />
        )}
      </SettingsGroup>

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={t("about.diagnostics.dialogTitle")}
      >
        {report?.step === "sent" ? (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-fg-muted">
              {t("about.diagnostics.sentBody")}
            </p>
            <p className="select-all break-all rounded-md border border-border bg-fill px-3 py-2 font-mono text-xs text-fg">
              {report.reportId}
            </p>
            <div className="flex justify-end">
              <Button size="sm" onClick={closeDialog}>
                {t("about.diagnostics.done")}
              </Button>
            </div>
          </div>
        ) : report ? (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-fg-muted">
              {t("about.diagnostics.previewBody")}
            </p>
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-fill px-3 py-2 font-mono text-xs leading-5 text-fg-muted">
              {JSON.stringify(report.bundle, null, 2)}
            </pre>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={report.step === "sending"}
                onClick={closeDialog}
              >
                {t("about.diagnostics.cancel")}
              </Button>
              <Button
                size="sm"
                disabled={report.step === "sending"}
                onClick={() => void handleSend(report.bundle)}
              >
                {report.step === "sending" && <Spinner size="sm" />}
                {t("about.diagnostics.send")}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
