// SQLite implementation of the Store contract using Node's built-in node:sqlite.
// All queries are parameterised. Shipments, cases and drafts are stored as JSON documents
// next to the few columns we filter and sort on.
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CaseStatus, ExceptionCase, Shipment } from '../core/types';
import type { CaseFilter, DraftRecord, Store } from './types';

export const SCHEMA_VERSION = 1;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  status TEXT NOT NULL,
  severity_rank INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cases_status_idx ON cases (status);
CREATE INDEX IF NOT EXISTS cases_shipment_idx ON cases (shipment_id);
CREATE TABLE IF NOT EXISTS drafts (
  case_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const SEVERITY_RANK: Record<string, number> = { high: 0, med: 1, low: 2 };
const STATUSES: readonly string[] = ['open', 'drafted', 'resolved', 'dismissed'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseJson(text: unknown): unknown {
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toShipment(text: unknown): Shipment | null {
  const v = parseJson(text);
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.reference !== 'string') return null;
  if (!Array.isArray(v.events) || !Array.isArray(v.documents)) return null;
  return v as unknown as Shipment;
}

function toCase(text: unknown, status: unknown): ExceptionCase | null {
  const v = parseJson(text);
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.shipmentId !== 'string') return null;
  if (typeof v.ruleId !== 'string' || typeof status !== 'string' || !STATUSES.includes(status)) return null;
  // The status column is the source of truth; the JSON copy can be stale.
  return { ...(v as unknown as ExceptionCase), status: status as CaseStatus };
}

function toDraft(text: unknown): DraftRecord | null {
  const v = parseJson(text);
  if (!isRecord(v) || typeof v.caseId !== 'string' || typeof v.body !== 'string') return null;
  return v as unknown as DraftRecord;
}

export function openSqliteStore(path: string | ':memory:'): Store {
  if (path !== ':memory:') {
    // Shipment data is private: directories we create are 0700 and the database file is 0600 (best effort).
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      if (!existsSync(path)) closeSync(openSync(path, 'a', 0o600));
    } catch {
      /* fall through: SQLite will create the file itself */
    }
  }
  const db = new DatabaseSync(path);
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        chmodSync(path + suffix, 0o600);
      } catch {
        /* the sidecar files may not exist yet, or the filesystem may not support modes */
      }
    }
  }
  db.exec('PRAGMA busy_timeout = 5000;');

  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  const version = row?.user_version ?? 0;
  if (version > SCHEMA_VERSION) {
    db.close();
    throw new Error(`Database schema version ${version} is newer than this app supports (${SCHEMA_VERSION}).`);
  }
  if (version < 1) {
    db.exec('BEGIN');
    try {
      db.exec(SCHEMA_V1);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  const upsertShipment = db.prepare(
    `INSERT INTO shipments (id, reference, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET reference = excluded.reference, data = excluded.data, updated_at = excluded.updated_at`,
  );
  const selectCaseStatus = db.prepare('SELECT status, data FROM cases WHERE id = ?');
  const insertCase = db.prepare(
    `INSERT INTO cases (id, shipment_id, rule_id, status, severity_rank, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateCase = db.prepare(
    `UPDATE cases SET shipment_id = ?, rule_id = ?, severity_rank = ?, data = ?, updated_at = ? WHERE id = ?`,
  );

  function inTransaction(fn: () => void): void {
    db.exec('BEGIN');
    try {
      fn();
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  const now = () => new Date().toISOString();
  let closed = false;

  return {
    async upsertShipments(shipments) {
      inTransaction(() => {
        for (const s of shipments) upsertShipment.run(s.id, s.reference, JSON.stringify(s), now());
      });
    },

    async listShipments() {
      const rows = db.prepare('SELECT data FROM shipments ORDER BY reference, id').all();
      const out: Shipment[] = [];
      for (const r of rows) {
        const s = toShipment((r as { data: unknown }).data);
        if (s) out.push(s);
      }
      return out;
    },

    async getShipment(id) {
      const r = db.prepare('SELECT data FROM shipments WHERE id = ?').get(id) as { data: unknown } | undefined;
      return r ? toShipment(r.data) : null;
    },

    async saveCases(cases) {
      inTransaction(() => {
        for (const c of cases) {
          const existing = selectCaseStatus.get(c.id) as { status: string; data: string } | undefined;
          const rank = SEVERITY_RANK[c.severity] ?? 3;
          if (!existing) {
            insertCase.run(c.id, c.shipmentId, c.ruleId, c.status, rank, JSON.stringify(c), now());
            continue;
          }
          // Keep the person's status and the original detection time; refresh everything else.
          // Exception: a case that NEW DATA resolved is re-opened, because the rules detect it again.
          const prev = parseJson(existing.data);
          const prevDetected = isRecord(prev) && typeof prev.detectedAt === 'string' ? prev.detectedAt : c.detectedAt;
          const prevBy: 'person' | 'data' | undefined =
            isRecord(prev) && (prev.resolvedBy === 'person' || prev.resolvedBy === 'data') ? prev.resolvedBy : undefined;
          const { resolvedBy: _ignored, ...fresh } = c;
          void _ignored;
          let status = existing.status as CaseStatus;
          let by: 'person' | 'data' | undefined = prevBy;
          if (status === 'resolved' && prevBy === 'data') {
            status = 'open';
            by = undefined;
          }
          const kept: ExceptionCase = { ...fresh, status, detectedAt: prevDetected, ...(by ? { resolvedBy: by } : {}) };
          if (status !== existing.status) db.prepare('UPDATE cases SET status = ? WHERE id = ?').run(status, c.id);
          updateCase.run(c.shipmentId, c.ruleId, rank, JSON.stringify(kept), now(), c.id);
        }
      });
    },

    async listCases(filter?: CaseFilter) {
      const where: string[] = [];
      const params: string[] = [];
      if (filter?.status !== undefined) {
        const list = Array.isArray(filter.status) ? filter.status : [filter.status];
        if (list.length === 0) return [];
        where.push(`status IN (${list.map(() => '?').join(', ')})`);
        params.push(...list);
      }
      if (filter?.ruleId !== undefined) {
        where.push('rule_id = ?');
        params.push(filter.ruleId);
      }
      if (filter?.shipmentId !== undefined) {
        where.push('shipment_id = ?');
        params.push(filter.shipmentId);
      }
      const sql = `SELECT data, status FROM cases${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY severity_rank, id`;
      const rows = db.prepare(sql).all(...params);
      const out: ExceptionCase[] = [];
      for (const r of rows) {
        const c = toCase((r as { data: unknown }).data, (r as { status: unknown }).status);
        if (c) out.push(c);
      }
      return out;
    },

    async getCase(id) {
      const r = db.prepare('SELECT data, status FROM cases WHERE id = ?').get(id) as
        | { data: unknown; status: unknown }
        | undefined;
      return r ? toCase(r.data, r.status) : null;
    },

    async setCaseStatus(id, status, by) {
      if (!STATUSES.includes(status)) throw new Error(`Invalid case status: ${String(status)}`);
      const row = db.prepare('SELECT data FROM cases WHERE id = ?').get(id) as { data: unknown } | undefined;
      if (!row) throw new Error(`Case not found: ${id}`);
      // Record who resolved it; open and drafted cases carry no resolvedBy.
      const resolvedBy = status === 'resolved' ? (by ?? 'person') : status === 'dismissed' ? 'person' : undefined;
      const parsed = parseJson(row.data);
      let data = row.data as string;
      if (isRecord(parsed)) {
        const next: Record<string, unknown> = { ...parsed, status };
        if (resolvedBy) next.resolvedBy = resolvedBy;
        else delete next.resolvedBy;
        data = JSON.stringify(next);
      }
      db.prepare('UPDATE cases SET status = ?, data = ?, updated_at = ? WHERE id = ?').run(status, data, now(), id);
    },

    async saveDraft(draft) {
      db.prepare(
        `INSERT INTO drafts (case_id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(case_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      ).run(draft.caseId, JSON.stringify(draft), now());
    },

    async getDraft(caseId) {
      const r = db.prepare('SELECT data FROM drafts WHERE case_id = ?').get(caseId) as { data: unknown } | undefined;
      return r ? toDraft(r.data) : null;
    },

    async clearAll() {
      inTransaction(() => {
        db.exec('DELETE FROM drafts; DELETE FROM cases; DELETE FROM shipments;');
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
