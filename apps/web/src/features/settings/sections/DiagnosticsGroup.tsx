/**
 * Settings → About → Diagnostics: export the diagnostics bundle to a file, or
 * send it to the developers through the relay — both behind the same explicit
 * preview-and-confirm dialog. The
 * app never uploads anything on its own; this group is the entire reporting
 * surface.
 */
import { Button, Dialog, Spinner } from "@read-aware/ui";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { isMobileOS, isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import { useTranslation } from "../../../i18n";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsRow } from "../components/SettingsRow";
import { useMaintenanceSurface } from "../hooks/useMaintenanceSurface";
import { useDiagnosticsReport } from "../hooks/useDiagnosticsReport";
import { diagnosticsLogDir } from "../lib/diagnostics";

const log = createLogger("diagnostics");

export function DiagnosticsGroup() {
  const { t } = useTranslation("settings");
  const diagnosticsControlRef = useMaintenanceSurface("diagnostics");
  const { report, open, confirm, close } = useDiagnosticsReport();

  const handleRevealLogs = async () => {
    try {
      await revealItemInDir(await diagnosticsLogDir());
    } catch (error) {
      log.error("revealing the log folder failed", error);
    }
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
              ref={diagnosticsControlRef}
              variant="outline"
              size="sm"
              disabled={report !== null}
              onClick={() => open("export")}
            >
              {report?.step === "assembling" && report.action === "export" && <Spinner size="sm" />}
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
              disabled={report !== null}
              onClick={() => open("send")}
            >
              {report?.step === "assembling" && report.action === "send" && <Spinner size="sm" />}
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
        open={report !== null}
        onClose={close}
        title={t(report?.action === "export" ? "about.diagnostics.exportRow.title" : "about.diagnostics.dialogTitle")}
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
              <Button size="sm" onClick={close}>
                {t("about.diagnostics.done")}
              </Button>
            </div>
          </div>
        ) : report?.step === "assembling" ? (
          <div className="flex justify-center py-6"><Spinner /></div>
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
                disabled={report.step === "working"}
                onClick={close}
              >
                {t("about.diagnostics.cancel")}
              </Button>
              <Button
                size="sm"
                disabled={report.step === "working"}
                onClick={() => void confirm()}
              >
                {report.step === "working" && <Spinner size="sm" />}
                {t(report.action === "export" ? "about.diagnostics.exportRow.button" : "about.diagnostics.send")}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
