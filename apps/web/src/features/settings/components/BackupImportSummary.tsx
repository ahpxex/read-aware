import { Body, Button, Stack } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { backupMergeSummary } from "../lib/full-backup-review-model";
import type { useBackupImport } from "../hooks/useBackupImport";

type BackupImportFlow = ReturnType<typeof useBackupImport>;

export type BackupReviewView = Extract<NonNullable<BackupImportFlow["view"]>, { step: "review" }>;

/** The one confirmation a restore asks for: what the backup adds to this library. */
export function BackupImportSummary({ flow, view }: { flow: BackupImportFlow; view: BackupReviewView }) {
  const { t } = useTranslation("settings");
  const adds = backupMergeSummary(view.model);
  const conflicts = view.review.plan.conflictingEvents;
  return (
    <Stack gap="md" aria-busy={view.busy}>
      <Body>
        {t("dataSync.importDialog.summary", {
          events: view.review.plan.newEvents,
          files: adds.files,
          plugins: adds.plugins,
          credentials: adds.credentials,
        })}
      </Body>
      <Body>{t("dataSync.importDialog.mergeNotice")}</Body>
      {conflicts > 0 && <Body role="alert">{t("dataSync.importDialog.eventConflict", { count: conflicts })}</Body>}
      {view.error && <Body role="alert">{view.error}</Body>}
      <Stack direction="horizontal" justify="end" gap="sm">
        <Button variant="ghost" disabled={view.busy} onClick={flow.cancel}>
          {t("dataSync.deleteAll.cancel")}
        </Button>
        <Button disabled={view.busy || conflicts > 0} onClick={() => void flow.restore()}>
          {t("dataSync.importDialog.restore")}
        </Button>
      </Stack>
    </Stack>
  );
}
