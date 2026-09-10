/** Counts only. No table names, row samples, identifiers, logs or user content. */
export type ProjectionVerification = {
  scope: "event-projections";
  checkedAt: string;
  consistent: boolean;
  eventsReplayed: number;
  driftedTables: number;
  onlyLiveRows: number;
  onlyReplayedRows: number;
};

export type HostDiagnosticsPort = {
  /** Explicit local check, not a repair or a check of remote devices/backups.
   * Cancellation stops waiting, not the shared native replay/rollback. */
  verifyProjections(signal?: AbortSignal): Promise<ProjectionVerification>;
};
