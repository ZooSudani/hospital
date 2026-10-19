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
    async run() { sqlite.prepare(sql).run(...args); return { success: true }; },
    _exec() { sqlite.prepare(sql).run(...args); },
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      sqlite.exec('BEGIN');
      try { list.forEach((s) => s._exec()); sqlite.exec('COMMIT'); }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
    raw: sqlite,
  };
}
