import { Body, Button, Caption, ChoiceGroup, Heading, Select, Stack } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { BackupImportFlow } from "./BackupImportDialog";
import { BackupImportChoices } from "./BackupImportChoices";
import { backupChoicesComplete } from "../lib/full-backup-review-model";
import { backupCellText } from "../lib/full-backup-review-model";

export type BackupReviewView = Extract<NonNullable<BackupImportFlow["view"]>, { step: "review" }>;

export function BackupImportReview({ flow, view }: { flow: BackupImportFlow; view: BackupReviewView }) {
  const { t } = useTranslation("settings");
  const sides = [
    { value: "source", label: t("dataSync.importDialog.source") },
    { value: "target", label: t("dataSync.importDialog.target") },
  ];
  return (
    <Stack gap="lg" aria-busy={view.busy}>
      <Body>
        {t("dataSync.importDialog.summary", {
          events: view.review.plan.newEvents,
          rows: view.model.decisions.unresolved,
          files: view.model.files.length,
          plugins: view.model.programs.length,
          credentials: view.model.credentials.length,
        })}
      </Body>
      {view.review.plan.conflictingEvents > 0 && (
        <Body role="alert">
          {t("dataSync.importDialog.eventConflict", { count: view.review.plan.conflictingEvents })}
        </Body>
      )}
      <Body>{t("dataSync.importDialog.bulkNotice")}</Body>
      <Stack direction="horizontal" gap="sm" className="flex-wrap">
        <Button disabled={view.busy} onClick={() => void flow.bulk("source")}>
          {t("dataSync.importDialog.bulkSource")}
        </Button>
        <Button variant="outline" disabled={view.busy} onClick={() => void flow.bulk("target")}>
          {t("dataSync.importDialog.bulkTarget")}
        </Button>
      </Stack>
      <details>
        <summary className="cursor-pointer text-sm">{t("dataSync.importDialog.records")}</summary>
        <Stack gap="md" className="pt-3">
          <Select
            label={t("dataSync.importDialog.table")}
            disabled={view.busy}
            value={view.table}
            options={Object.entries(view.review.plan.tables)
              .filter(([, table]) => table.comparisons && table.sourceRows + table.targetRows > 0)
              .map(([table]) => ({
                value: table,
                label: t(`dataSync.importDialog.tables.${table}`, { defaultValue: table }),
              }))}
            onChange={(table) => void flow.selectTable(table)}
          />
          {view.rows?.entries.map((row) => (
            <Stack key={row.entryId} gap="sm" className="border-b border-border pb-3">
              <Stack direction="horizontal" justify="between" gap="sm">
                <Caption>
                  {t("dataSync.importDialog.record", { id: row.entryId })} ·{" "}
                  {t(`dataSync.importDialog.kinds.${row.kind}`)}
                </Caption>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={view.busy}
                  onClick={() => void flow.inspectRow(row.entryId)}
                >
                  {t("dataSync.importDialog.inspect")}
                </Button>
              </Stack>
              {row.selectable ? (
                <ChoiceGroup
                  label={t("dataSync.importDialog.valueSource")}
                  value={row.selection ?? "clear"}
                  disabled={view.busy}
                  options={[{ value: "clear", label: t("dataSync.importDialog.unselected") }, ...sides]}
                  onChange={(choice) => void flow.chooseRow(row.entryId, choice as "source" | "target" | "clear")}
                />
              ) : (
                <Caption>{t("dataSync.importDialog.managed")}</Caption>
              )}
            </Stack>
          ))}
          {view.rows && (
            <Stack direction="horizontal" gap="sm">
              <Button variant="ghost" disabled={view.busy} onClick={() => void flow.selectTable(view.table)}>
                {t("dataSync.importDialog.firstPage")}
              </Button>
              <Button
                variant="ghost"
                disabled={view.busy || view.rows.nextAfter === null}
                onClick={() => void flow.selectTable(view.table, view.rows!.nextAfter)}
              >
                {t("dataSync.importDialog.nextPage")}
              </Button>
            </Stack>
          )}
          {view.fields && (
            <Stack gap="md" className="rounded-surface border border-border p-3">
              <Heading as="h3" className="text-lg">
                {t("dataSync.importDialog.record", { id: view.fields.entryId })}
              </Heading>
              {view.fields.restricted && <Body>{t("dataSync.importDialog.restricted")}</Body>}
              {view.fields.entries.map((field) => (
                <Stack key={field.name} gap="sm">
                  <Caption>{field.name}</Caption>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(["source", "target"] as const).map((side) => {
                      const cell = field[side];
                      return (
                        <div key={side} className="min-w-0">
                          <Caption>{t(`dataSync.importDialog.${side}`)}</Caption>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
                            {backupCellText(cell, t("dataSync.importDialog.absent"), t("dataSync.importDialog.null"))}
                          </pre>
                          {cell && (cell.type === "blob" || cell.type === "text") && (
                            <Caption>
                              {cell.offset}–{cell.nextOffset ?? cell.byteLength} / {cell.byteLength} bytes
                            </Caption>
                          )}
                          {cell && (cell.type === "blob" || cell.type === "text") && cell.nextOffset !== null && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={view.busy}
                              onClick={() => void flow.fieldChunk(field.name, side, cell.nextOffset!)}
                            >
                              {t("dataSync.importDialog.nextChunk")}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Stack>
              ))}
              {view.fields.nextAfter !== null && (
                <Button
                  variant="ghost"
                  disabled={view.busy}
                  onClick={() => void flow.inspectRow(view.fields!.entryId, view.fields!.nextAfter)}
                >
                  {t("dataSync.importDialog.moreFields")}
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </details>
      <BackupImportChoices flow={flow} view={view} />
      {view.issues && (
        <Stack gap="sm" role="status">
          <Body>{t(view.confirmed ? "dataSync.importDialog.checked" : "dataSync.importDialog.constraintsFailed")}</Body>
          {view.issues.entries.map((issue) => (
            <Caption key={issue.id}>
              {t(`dataSync.importDialog.tables.${issue.table}`, { defaultValue: issue.table })} · {issue.entryId ?? "—"}{" "}
              · {issue.kind}
            </Caption>
          ))}
          {view.issues.nextAfter !== null && <Caption>{t("dataSync.importDialog.moreIssues")}</Caption>}
        </Stack>
      )}
      {view.error && <Body role="alert">{view.error}</Body>}
      {view.confirmed && <Body>{t("dataSync.importDialog.confirmNotice")}</Body>}
      <Stack direction="horizontal" justify="end" gap="sm" className="flex-wrap">
        <Button variant="ghost" onClick={flow.cancel}>
          {t("dataSync.deleteAll.cancel")}
        </Button>
        <Button
          variant="outline"
          disabled={view.busy || !backupChoicesComplete(view.model) || view.review.plan.conflictingEvents > 0}
          onClick={() => void flow.check()}
        >
          {t("dataSync.importDialog.check")}
        </Button>
        <Button disabled={view.busy || !view.confirmed} onClick={() => void flow.restore()}>
          {t("dataSync.importDialog.restore")}
        </Button>
      </Stack>
    </Stack>
  );
}
