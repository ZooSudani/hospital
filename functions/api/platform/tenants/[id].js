import { passwordProblem, hashPassword } from '../../../../lib/auth.js';
import { auditRaw } from '../../../../lib/audit.js';
import { can, fail, json, readJson } from '../../../../lib/http.js';

// إيقاف المستشفى أو تفعيله، وإعادة تعيين كلمة مرور مديره. لمدير المنصة فقط.
export async function onRequestPatch({ request, params, env, data }) {
  if (!can(data.auth, 'platform_admin')) return fail(403, 'للمدير العام للمنصة فقط');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');

  const tenant = await env.DB.prepare(`SELECT id, name, slug, status FROM tenants WHERE id = ?`).bind(params.id).first();
  if (!tenant) return fail(404, 'المستشفى غير موجود');

  const changed = [];
  let adminEmail = null;

  if (b.status !== undefined) {
    if (!['active', 'suspended'].includes(b.status)) return fail(400, 'الحالة غير صحيحة');
    await env.DB.prepare(`UPDATE tenants SET status = ? WHERE id = ?`).bind(b.status, tenant.id).run();
    changed.push('status');
  }

  if (b.admin_password !== undefined) {
    const email = b.admin_email ? String(b.admin_email).trim().toLowerCase() : null;
    const admin = email
      ? await env.DB.prepare(`SELECT id, email, name FROM users WHERE tenant_id = ? AND role = 'admin' AND email = ?`).bind(tenant.id, email).first()
      : await env.DB.prepare(`SELECT id, email, name FROM users WHERE tenant_id = ? AND role = 'admin' ORDER BY created_at LIMIT 1`).bind(tenant.id).first();
    if (!admin) return fail(404, 'مدير المستشفى غير موجود');
    const problem = passwordProblem(b.admin_password, admin.email, admin.name);
    if (problem) return fail(400, problem);

    // رفع token_version يُسقط جلساته الحالية، وحذف عداد القفل يمكّنه من الدخول فورًا بكلمته الجديدة
    await env.DB.prepare(`UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ? AND tenant_id = ?`)
      .bind(await hashPassword(String(b.admin_password)), admin.id, tenant.id)
      .run();
    await env.DB.prepare(`DELETE FROM login_attempts WHERE key = ?`).bind(`u:${tenant.slug}:${admin.email}`).run();
    adminEmail = admin.email;
    changed.push('admin_password');
  }

  if (!changed.length) return fail(400, 'لا يوجد ما يُعدَّل');
  await auditRaw(env.DB, { tenant_id: tenant.id, user_id: data.auth.uid, action: 'tenant.update', target: tenant.slug, detail: changed.join(','), ip: data.auth.ip });
  return json({ ok: true, admin_email: adminEmail });
}
