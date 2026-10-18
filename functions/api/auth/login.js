import { hashPassword, signToken, verifyPassword } from '../../../lib/auth.js';
import { fail, json, readJson } from '../../../lib/http.js';

const BAD = 'بيانات الدخول غير صحيحة';

export async function onRequestPost({ request, env }) {
  if (!env.JWT_SECRET) return fail(500, 'المتغير JWT_SECRET غير مضبوط');
  const b = await readJson(request);
  const slug = String(b?.slug || '').trim().toLowerCase();
  const email = String(b?.email || '').trim().toLowerCase();
  const password = String(b?.password || '');
  if (!slug || !email || !password) return fail(400, 'أدخل رمز المستشفى والبريد وكلمة المرور');

  let tenant = null;
  let user = null;

  if (slug === 'platform') {
    user = await env.DB.prepare(`SELECT * FROM users WHERE tenant_id IS NULL AND email = ? AND active = 1`)
      .bind(email)
      .first();
  } else {
    tenant = await env.DB.prepare(`SELECT id, name, status FROM tenants WHERE slug = ?`).bind(slug).first();
    if (tenant && tenant.status === 'active') {
      user = await env.DB.prepare(`SELECT * FROM users WHERE tenant_id = ? AND email = ? AND active = 1`)
        .bind(tenant.id, email)
        .first();
    }
  }

  // نفس زمن المعالجة سواء وُجد المستخدم أو لا، حتى لا يُكشف وجود الحساب
  const ok = user ? await verifyPassword(password, user.password_hash) : (await hashPassword(password), false);
  if (!ok) return fail(401, BAD);

  const token = await signToken({ sub: user.id, tid: user.tenant_id, role: user.role }, env.JWT_SECRET);
  return json({
    token,
    user: { id: user.id, name: user.name, role: user.role },
    tenant: tenant ? { id: tenant.id, name: tenant.name } : null,
  });
}
