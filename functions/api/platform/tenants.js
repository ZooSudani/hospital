import { hashPassword } from '../../../lib/auth.js';
import { can, fail, json, readJson } from '../../../lib/http.js';

export async function onRequestGet({ env, data }) {
  if (!can(data.auth, 'platform_admin')) return fail(403, 'للمدير العام للمنصة فقط');
  const { results } = await env.DB.prepare(
    `SELECT id, name, slug, status, created_at FROM tenants ORDER BY created_at DESC`
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
  if (!adminEmail.includes('@') || adminName.length < 2 || adminPassword.length < 8) {
    return fail(400, 'بيانات مدير المستشفى غير مكتملة (كلمة المرور 8 أحرف على الأقل)');
  }

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
  return json({ id: tenantId, slug }, 201);
}
