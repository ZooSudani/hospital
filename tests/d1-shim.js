// غلاف يحاكي واجهة D1 فوق node:sqlite، لاختبار الواجهات محليًا بنفس الاستعلامات.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function makeDb(schema) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema ?? readFileSync(new URL('../schema/shared.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { const r = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    _exec() { const r = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      sqlite.exec('BEGIN');
      try { const out = list.map((s) => s._exec()); sqlite.exec('COMMIT'); return out; }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
    raw: sqlite,
  };
}
