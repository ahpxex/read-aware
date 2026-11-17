import type { BackupProgramFacts } from "../../plugins/runtime/backup-program-review";

export type BackupReviewQuery = {
  kind: "events" | "files" | "programs" | "credentials";
  after?: string | null;
  limit: number;
};
type Page<K extends string, E, C = string> = { kind: K; entries: E[]; nextAfter: C | null };
type RowKind = "sourceOnly" | "targetOnly" | "same" | "different";
type CapturedFile = { path: string; byteSize: number; sha256: string };
type RoamingState = "absent" | "value" | "deleted" | "locked";
export type BackupCredentialFacts = {
  slot: string;
  sourceLocal: boolean;
  targetLocal: boolean;
  sourcePendingPublication: boolean;
  targetPendingPublication: boolean;
  localEqual: boolean | null;
  sourceRoaming: RoamingState;
  targetRoaming: RoamingState;
  sourceLocalMatchesRoaming: boolean | null;
  targetLocalMatchesRoaming: boolean | null;
};
export type BackupReviewPage =
  | Page<
      "events",
      {
        sourceId: string;
        kind: "new" | "existing" | "idConflict" | "clockConflict" | "idAndClockConflict";
        sourceDigest: string;
        idTargetDigest: string | null;
        clockTargetId: string | null;
        clockTargetDigest: string | null;
      }
    >
  | Page<
      "files",
      {
        path: string;
        policy: "blob" | "programTree" | "preserveCredentialKey";
        kind: RowKind | "unavailable";
        source: CapturedFile | null;
        target: CapturedFile | null;
        targetBlob: {
          key: string | null;
          availability: "local" | "unavailable" | "missingLocalFile" | "registryMismatch" | "unregisteredFile";
        } | null;
      }
    >
  | Page<"programs", BackupProgramFacts>
  | Page<"credentials", BackupCredentialFacts>;
