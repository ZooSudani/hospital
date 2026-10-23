import { can, fail, json } from '../../../lib/http.js';

// نشاط كل المستشفيات لمدير المنصة (آخر 100 حدث). أحداث المرضى والمواعيد  تظهر دون أي تفاصيل أو معرّفات.
const DETAIL_VISIBLE = /^(tenant\.|login\.|staff\.|platform\.|account\.)/;

export async function onRequestGet({ env, data }) {
  if (!can(data.auth, 'platform_admin')) return fail(403, 'للمدير العام للمنصة فقط');
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.action, a.detail, a.ip, a.created_at, t.name AS tenant_name, u.name AS user_name
     FROM audit_log a
     LEFT JOIN tenants t ON t.id = a.tenant_id
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC LIMIT 100`
  ).all();
  const events = results.map((e) => ({
    id: e.id,
    action: e.action,
    created_at: e.created_at,
    tenant_name: e.tenant_name,
    user_name: e.user_name,
    detail: DETAIL_VISIBLE.test(e.action) ? e.detail : null,
    ip: e.action.startsWith('login.') ? e.ip : null,
  }));
  return json({ events });
}
