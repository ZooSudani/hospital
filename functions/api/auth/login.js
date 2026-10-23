import { hashPassword, signToken, verifyPassword } from '../../../lib/auth.js';
import { auditRaw } from '../../../lib/audit.js';
import { clientIp, fail, json, readJson } from '../../../lib/http.js';
import { effectivePermissions, parseOverrides } from '../../../lib/permissions.js';
import { clearFailures, isLocked, recordFailure } from '../../../lib/throttle.js';

const BAD = 'بيانات الدخول غير صحيحة';
const USER_LIMIT = 5;  // محاولات فاشلة لكل (مستشفى + بريد) خلال 15 دقيقة
const IP_LIMIT = 20;   // محاولات فاشلة لكل عنوان خلال 15 دقيقة

export async function onRequestPost({ request, env }) {
  if (!env.JWT_SECRET || String(env.JWT_SECRET).length < 32) return fail(500, 'المتغير JWT_SECRET غير مضبوط أو ضعيف (32 حرفًا على الأقل)');
  const b = await readJson(request);
  const slug = String(b?.slug || '').trim().toLowerCase().slice(0, 40);
  const email = String(b?.email || '').trim().toLowerCase().slice(0, 120);
  const password = String(b?.password || '').slice(0, 200);
  if (!slug || !email || !password) return fail(400, 'أدخل رمز المستشفى والبريد وكلمة المرور');

  const ip = clientIp(request);
  const userKey = `u:${slug}:${email}`;
  const ipKey = `ip:${ip}`;

  // الفحص قبل أي عمل ثقيل: يمنع التخمين ويحمي المعالج من الإغراق
  if ((await isLocked(env.DB, userKey, USER_LIMIT)) || (await isLocked(env.DB, ipKey, IP_LIMIT))) {
    return fail(429, 'محاولات كثيرة فاشلة. حاول بعد 15 دقيقة');
  }

  let tenant = null;
  let user = null;

  if (slug === 'platform') {
    user = await env.DB.prepare(`SELECT * FROM users WHERE tenant_id IS NULL AND email = ? AND active = 1`).bind(email).first();
  } else {
    tenant = await env.DB.prepare(`SELECT id, name, status FROM tenants WHERE slug = ?`).bind(slug).first();
    if (tenant && tenant.status === 'active') {
      user = await env.DB.prepare(`SELECT * FROM users WHERE tenant_id = ? AND email = ? AND active = 1`).bind(tenant.id, email).first();
    }
  }

  // نفس زمن المعالجة سواء وُجد المستخدم أو لا، حتى لا يُكشف وجود الحساب
  const ok = user ? await verifyPassword(password, user.password_hash) : (await hashPassword(password), false);

  if (!ok) {
    await recordFailure(env.DB, userKey);
    await recordFailure(env.DB, ipKey);
    // نسجّل الفشل فقط لمستشفى موجود أو للمنصة، حتى لا يملأ المهاجم السجل بأسماء وهمية
    if (tenant || slug === 'platform') {
      await auditRaw(env.DB, { tenant_id: tenant?.id ?? null, user_id: user?.id ?? null, action: 'login.fail', detail: email, ip });
    }
    return fail(401, BAD);
  }

  await clearFailures(env.DB, userKey);
  await auditRaw(env.DB, { tenant_id: user.tenant_id, user_id: user.id, action: 'login.ok', ip });

  const token = await signToken({ sub: user.id, tid: user.tenant_id, role: user.role, tv: user.token_version }, env.JWT_SECRET);
  return json({
    token,
    user: { id: user.id, name: user.name, role: user.role },
    permissions: user.tenant_id ? effectivePermissions(user.role, parseOverrides(user.perm_overrides)) : [],
    tenant: tenant ? { id: tenant.id, name: tenant.name } : null,
  });
}
