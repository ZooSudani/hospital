import { auditRaw } from '../../../../../../../lib/audit.js';
import { can, fail, json, readJson } from '../../../../../../../lib/http.js';
import { normalizeOverrides, permissionsInfo } from '../../../../../../../lib/permissions.js';

// صلاحيات موظف في أي مستشفى، لمدير المنصة. هو وحده يمنح الصلاحيات الحساسة ويعدّل صلاحيات المديرين.
async function load(env, params) {
  return env.DB.prepare(`SELECT id, name, role, perm_overrides FROM users WHERE id = ? AND tenant_id = ?`).bind(params.uid, params.id).first();
}

export async function onRequestGet({ params, env, data }) {
  if (!can(data.auth, 'platform_admin')) return fail(403, 'للمدير العام للمنصة فقط');
  const target = await load(env, params);
  if (!target) return fail(404, 'الموظف غير موجود');
  return json({ name: target.name, editable: true, ...permissionsInfo(target.role, target.perm_overrides, { callerIsPlatform: true }) });
}

export async function onRequestPut({ request, params, env, data }) {
  if (!can(data.auth, 'platform_admin')) return fail(403, 'للمدير العام للمنصة فقط');
  const target = await load(env, params);
  if (!target) return fail(404, 'الموظف غير موجود');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');
  const norm = normalizeOverrides(b, target.role, { callerIsPlatform: true });
  if (norm.error) return fail(400, norm.error);

  const { grant, deny } = norm.value;
  await env.DB.prepare(`UPDATE users SET perm_overrides = ? WHERE id = ? AND tenant_id = ?`)
    .bind(grant.length || deny.length ? JSON.stringify(norm.value) : null, target.id, params.id)
    .run();
  await auditRaw(env.DB, { tenant_id: params.id, user_id: data.auth.uid, action: 'staff.permissions', target: target.id, detail: `+${grant.length} -${deny.length}`, ip: data.auth.ip });
  return json({ ok: true });
}
