import { hashPassword, passwordProblem } from '../../../lib/auth.js';
import { auditRaw } from '../../../lib/audit.js';
import { can, fail, json, readJson } from '../../../lib/http.js';

export async function onRequestGet({ env, data }) {
  if (!can(data.auth, 'platform_admin')) return fail(403, 'للمدير العام للمنصة فقط');
  // أعداد تجميعية فقط: لا أسماء مرضى ولا أي محتوى طبي
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, t.slug, t.status, t.created_at,
            (SELECT u.email FROM users u WHERE u.tenant_id = t.id AND u.role = 'admin' ORDER BY u.created_at LIMIT 1) AS admin_email,
            (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.active = 1) AS staff_count,
            (SELECT COUNT(*) FROM patients p WHERE p.tenant_id = t.id) AS patients_count,
            (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id = t.id) AS appointments_count,
            (SELECT MAX(l.created_at) FROM audit_log l WHERE l.tenant_id = t.id) AS last_activity
     FROM tenants t ORDER BY t.created_at DESC`
  ).all();
  return json({ tenants: results });
}

export async function onRequestPost({ request, env, data }) {
  if (!can(data.auth, 'platform_admin')) return fail(403, 'للمدير العام للمنصة فقط');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');

  const name = String(b.name || '').trim();
  const slug = String(b.slug || '').trim().toLowerCase();
  const adminEmail = String(b.admin_email || '').trim().toLowerCase();
  const adminName = String(b.admin_name || '').trim();
  const adminPassword = String(b.admin_password || '');

  if (name.length < 3) return fail(400, 'اسم المستشفى قصير');
  if (!/^[a-z0-9-]{3,30}$/.test(slug) || slug === 'platform') {
    return fail(400, 'رمز المستشفى: حروف إنجليزية صغيرة وأرقام وشرطة، من 3 إلى 30 خانة');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail) || adminName.length < 2 || adminName.length > 80) {
    return fail(400, 'اسم أو بريد مدير المستشفى غير صحيح');
  }
  const problem = passwordProblem(adminPassword, adminEmail, adminName);
  if (problem) return fail(400, problem);

  const tenantId = crypto.randomUUID();
  const passwordHash = await hashPassword(adminPassword);
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)`).bind(tenantId, name, slug),
      env.DB.prepare(
        `INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, 'admin')`
      ).bind(crypto.randomUUID(), tenantId, adminEmail, adminName, passwordHash),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail(409, 'رمز المستشفى مستخدم من قبل');
    throw e;
  }
  await auditRaw(env.DB, { tenant_id: tenantId, user_id: data.auth.uid, action: 'tenant.create', target: slug, ip: data.auth.ip });
  return json({ id: tenantId, slug }, 201);
}
