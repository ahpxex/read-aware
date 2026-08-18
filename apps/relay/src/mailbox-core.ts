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

  append(
    events: SealedEventWire[],
    receivedAt: string,
    maxEvents = Number.MAX_SAFE_INTEGER,
  ): Record<string, number> | "full" {
    // Quota pre-pass: how many of these are actually NEW. Refusal must be
    // atomic — a half-appended batch whose response says "full" would leave
    // the client with events it can neither confirm nor retire.
    const known = new Set<string>();
    for (const ev of events) {
      const row = this.sql.exec(`SELECT seq FROM events WHERE event_id = ?1`, ev.id).toArray()[0];
      if (row) known.add(ev.id);
    }
    const stored = this.count();
    const freshIds = new Set(events.filter((ev) => !known.has(ev.id)).map((ev) => ev.id));
    if (stored + freshIds.size > maxEvents) return "full";

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

  count(): number {
    return Number(this.sql.exec(`SELECT COUNT(*) AS n FROM events`).toArray()[0]?.n ?? 0);
  }

  maxSeq(): number {
    return Number(this.sql.exec(`SELECT COALESCE(MAX(seq), 0) AS s FROM events`).toArray()[0]?.s ?? 0);
  }

  wipe(): void {
    this.sql.exec(`DELETE FROM events`);
  }
}
