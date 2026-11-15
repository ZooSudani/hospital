import { can, fail, json } from '../../../lib/http.js';

// فحص سلامة قاعدة البيانات: هل شُغِّلت كل ملفات الترحيل؟ (الترحيل يدوي من D1 Console، فقد يُنسى ملف بعد رفع كود جديد)
const TABLES = [
  ['tenants', 'shared.sql'], ['users', 'shared.sql'], ['patients', 'shared.sql'], ['appointments', 'shared.sql'],
  ['visits', 'shared.sql'], ['invoices', 'shared.sql'], ['login_attempts', '003_security.sql'],
  ['audit_log', '003_security.sql'], ['payments', '005_payments.sql'],
];
const INDEXES = [['uq_doctor_slot', '002_appointments.sql'], ['uq_payment_ref', '005_payments.sql']];
const COLUMNS = [['users', 'token_version', '003_security.sql'], ['users', 'perm_overrides', '004_permissions.sql']];

export async function onRequestGet({ env, data }) {
  if (!can(data.auth, 'platform_admin')) return fail(403, 'للمدير العام للمنصة فقط');
  const { results } = await env.DB.prepare(`SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index')`).all();
  const have = new Set(results.map((o) => `${o.type}:${o.name}`));
  const missing = [];
  for (const [t, m] of TABLES) if (!have.has(`table:${t}`)) missing.push({ item: `جدول ${t}`, migration: m });
  for (const [i, m] of INDEXES) if (!have.has(`index:${i}`)) missing.push({ item: `فهرس ${i}`, migration: m });
  for (const table of [...new Set(COLUMNS.map((c) => c[0]))]) {
    if (!have.has(`table:${table}`)) continue;
    const { results: cols } = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    const names = new Set(cols.map((c) => c.name));
    for (const [t, c, m] of COLUMNS) if (t === table && !names.has(c)) missing.push({ item: `عمود ${t}.${c}`, migration: m });
  }
  return json({ ok: missing.length === 0, missing });
}
