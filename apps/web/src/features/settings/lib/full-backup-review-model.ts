import { AppError } from "@read-aware/core";
import type {
  BackupProgramChoice,
  BackupProgramDataFacts,
  BackupProgramFacts,
  BackupSide,
} from "../../plugins/runtime/backup-program-review";
import type { BackupCredentialChoice } from "./full-backup-apply";
import type { FullBackupReview } from "./full-backup-import-task";
import type { BackupCredentialFacts, BackupReviewPage } from "./backup-review-types";

export type BackupFileFact = Extract<BackupReviewPage, { kind: "files" }>["entries"][number];
/**
 * What a restore will do, decided by the one merge rule: keep what this
 * library has, add what only the backup has. The domain history merges
 * natively; files, plugins and credentials follow the same rule here.
 */
export type BackupReviewModel = {
  files: BackupFileFact[];
  programs: BackupProgramFacts[];
  credentials: BackupCredentialFacts[];
  fileChoices: Record<string, BackupSide>;
  programChoices: Record<string, BackupProgramChoice>;
  credentialChoices: Record<string, BackupCredentialChoice>;
};

export async function loadBackupReviewModel(review: FullBackupReview): Promise<BackupReviewModel> {
  const facts = {
    files: [] as BackupFileFact[],
    programs: [] as BackupProgramFacts[],
    credentials: [] as BackupCredentialFacts[],
  };
  for (const kind of ["files", "programs", "credentials"] as const) {
    let after: string | null = null;
    do {
      const page = await review.read({ kind, after, limit: 100 });
      if (page.kind === "files")
        facts.files.push(
          ...page.entries.filter((file) => file.policy === "blob" && file.source !== null && file.kind !== "same"),
        );
      else if (page.kind === "programs") facts.programs.push(...page.entries);
      else if (page.kind === "credentials") facts.credentials.push(...page.entries);
      else throw new AppError("backup/changed", "Unexpected backup catalog");
      after = page.nextAfter;
    } while (after !== null);
  }
  return { ...facts, ...mergeChoices(facts) };
}

const hasData = (data: BackupProgramDataFacts) => data.kvRows > 0 || data.documents > 0 || data.schema !== null;

/** Keep what this library has; take from the backup only what is missing here. */
export function mergeChoices(facts: Pick<BackupReviewModel, "files" | "programs" | "credentials">) {
  return {
    // A file only the backup holds is added; one both hold stays as it is here.
    fileChoices: Object.fromEntries(
      facts.files.map((file) => [file.path, file.kind === "sourceOnly" ? "source" : "target"] as const),
    ),
    credentialChoices: Object.fromEntries(
      facts.credentials.map((fact) => {
        const choice: BackupCredentialChoice = fact.targetLocal
          ? "targetLocal"
          : fact.sourceLocal
            ? "sourceLocal"
            : fact.targetRoaming === "value"
              ? "targetRoaming"
              : fact.sourceRoaming === "value"
                ? "sourceRoaming"
                : "targetLocal";
        return [fact.slot, choice] as const;
      }),
    ),
    programChoices: Object.fromEntries(
      facts.programs.map((fact) => {
        // Installed code stays; a plugin only the backup has brings its code,
        // which runs only after the reader approves it.
        const code =
          fact.candidates.find((candidate) => candidate.side === "target") ??
          fact.candidates.find((candidate) => candidate.side === "source" && candidate.mainPresent);
        const choice: BackupProgramChoice = {
          program: code ? { side: code.side, root: code.root, sha256: code.sha256 } : null,
          data: hasData(fact.targetData) || !hasData(fact.sourceData) ? "target" : "source",
        };
        return [fact.id, choice] as const;
      }),
    ),
  };
}

/** What the merge adds, for the confirmation the reader gives once. */
export function backupMergeSummary(model: BackupReviewModel) {
  return {
    files: Object.values(model.fileChoices).filter((side) => side === "source").length,
    plugins: Object.values(model.programChoices).filter(
      (choice) => choice.data === "source" || choice.program?.side === "source",
    ).length,
    credentials: Object.values(model.credentialChoices).filter((choice) => choice.startsWith("source")).length,
  };
}
