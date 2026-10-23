import { fail, json } from '../../lib/http.js';

// هوية المستخدم الحالية وصلاحياته الفعلية (تحدّثها الواجهة عند الفتح فتتبع آخر تعديل أجراه المدير)
export async function onRequestGet({ env, data }) {
  const a = data.auth;
  const row = a.tid
    ? await env.DB.prepare(`SELECT u.name AS name, t.id AS tid, t.name AS tname FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = ? AND u.tenant_id = ?`).bind(a.uid, a.tid).first()
    : await env.DB.prepare(`SELECT name FROM users WHERE id = ? AND tenant_id IS NULL`).bind(a.uid).first();
  if (!row) return fail(401, 'انتهت الجلسة. سجّل الدخول مرة أخرى');
  return json({
    user: { id: a.uid, name: row.name, role: a.role },
    tenant: a.tid ? { id: row.tid, name: row.tname } : null,
    permissions: a.perms,
  });
}
