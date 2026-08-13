/**
 * The mailbox's SQL, shared verbatim between the Durable Object (SQLite
 * storage API) and the bun:sqlite-backed tests. `server_seq` comes from
 * AUTOINCREMENT: monotonic, never reused, and the DO's single-threaded
 * execution makes assignment race-free without any locking of our own.
 */
import type { SealedEventWire } from "@read-aware/core";

/** The one sql-execution shape both `ctx.storage.sql` and the tests provide. */
export type SqlExec = {
  exec(query: string, ...bindings: (string | number | null)[]): {
    toArray(): Record<string, unknown>[];
  };
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
     seq          INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id     TEXT NOT NULL UNIQUE,
     hlc_wall_ms  INTEGER NOT NULL,
     hlc_counter  INTEGER NOT NULL,
     hlc_device   TEXT NOT NULL,
     envelope_json TEXT NOT NULL,
     received_at  TEXT NOT NULL
   )`,
];

export class MailboxCore {
  constructor(private sql: SqlExec) {}

  ensureSchema(): void {
    for (const statement of SCHEMA) this.sql.exec(statement);
  }

  append(events: SealedEventWire[], receivedAt: string): Record<string, number> {
    const seqs: Record<string, number> = {};
    for (const ev of events) {
      // Check-then-insert, NOT `INSERT OR IGNORE`: an ignored conflict still
      // burns an AUTOINCREMENT value, so every crash-redelivery would blow
      // holes in the seq space. The DO's single-threaded execution makes the
      // two statements race-free.
      const existing = this.sql
        .exec(`SELECT seq FROM events WHERE event_id = ?1`, ev.id)
        .toArray()[0];
      if (existing) {
        seqs[ev.id] = Number(existing.seq);
        continue;
      }
      this.sql.exec(
        `INSERT INTO events
           (event_id, hlc_wall_ms, hlc_counter, hlc_device, envelope_json, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        ev.id,
        ev.hlc.wallMs,
        ev.hlc.counter,
        ev.hlc.deviceId,
        JSON.stringify(ev),
        receivedAt,
      );
      const row = this.sql.exec(`SELECT seq FROM events WHERE event_id = ?1`, ev.id).toArray()[0];
      seqs[ev.id] = Number(row?.seq);
    }
    return seqs;
  }

  listAfter(after: number, limit: number): { events: SealedEventWire[]; next: number } {
    const rows = this.sql
      .exec(
        `SELECT seq, envelope_json FROM events WHERE seq > ?1 ORDER BY seq LIMIT ?2`,
        after,
        limit,
      )
      .toArray();
    const events = rows.map((row) => JSON.parse(String(row.envelope_json)) as SealedEventWire);
    const next = rows.length > 0 ? Number(rows[rows.length - 1].seq) : after;
    return { events, next };
  }

  wipe(): void {
    this.sql.exec(`DELETE FROM events`);
  }
}
