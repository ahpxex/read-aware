/**
 * ReportStore over a D1-shaped database plus an injected payload writer. The
 * metadata SQL is shared verbatim between the Worker (real D1) and the tests
 * (bun:sqlite through the same adapter as the account store); only the payload
 * destination differs — R2 in production, a Map in tests.
 */
import type { D1Like } from "./account-store";
import type { DiagnosticReportMeta, ReportStore } from "./ports";

export type ReportPayloadWriter = {
  put(id: string, payload: Uint8Array): Promise<void>;
};

export class SqlReportStore implements ReportStore {
  constructor(
    private db: D1Like,
    private payloads: ReportPayloadWriter,
  ) {}

  async submit(meta: DiagnosticReportMeta, payload: Uint8Array): Promise<void> {
    // Payload first: a metadata row pointing at nothing would list a report
    // the operator can never fetch. The reverse (orphaned payload) only costs
    // a few stray kilobytes in R2.
    await this.payloads.put(meta.id, payload);
    await this.db
      .prepare(
        `INSERT INTO diagnostic_reports
           (id, created_at, created_at_ms, ip_hash, app_version, platform, bytes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        meta.id,
        meta.createdAt,
        meta.createdAtMs,
        meta.ipHash,
        meta.appVersion,
        meta.platform,
        meta.bytes,
      )
      .run();
  }

  async countSince(ipHash: string, sinceMs: number): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM diagnostic_reports
         WHERE ip_hash = ?1 AND created_at_ms >= ?2`,
      )
      .bind(ipHash, sinceMs)
      .first<{ n: number }>();
    return Number(row?.n ?? 0);
  }
}
