/**
 * AiUsageStore over the same D1-shaped database as the account store: one
 * upsert-increment per completed AI request, one point read per admission
 * check. Rows are (account, UTC month) — a new month is a new row, so the
 * monthly reset is a calendar fact, not a job.
 */
import type { D1Like } from "./account-store";
import type { AiUsageStore } from "./ports";

export class SqlAiUsageStore implements AiUsageStore {
  constructor(private db: D1Like) {}

  async usedMicroUsd(accountId: string, month: string): Promise<number> {
    const row = await this.db
      .prepare(`SELECT micro_usd FROM ai_usage WHERE account_id = ?1 AND month = ?2`)
      .bind(accountId, month)
      .first<{ micro_usd: number }>();
    return row ? Number(row.micro_usd) : 0;
  }

  async add(accountId: string, month: string, microUsd: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO ai_usage (account_id, month, micro_usd, requests)
         VALUES (?1, ?2, ?3, 1)
         ON CONFLICT (account_id, month)
         DO UPDATE SET micro_usd = micro_usd + ?3, requests = requests + 1`,
      )
      .bind(accountId, month, microUsd)
      .run();
  }
}
