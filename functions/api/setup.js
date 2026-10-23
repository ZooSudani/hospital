import { hashPassword, passwordProblem, safeEqual } from '../../lib/auth.js';
import { auditRaw } from '../../lib/audit.js';
import { clientIp, fail, json, readJson } from '../../lib/http.js';
import { isLocked, recordFailure } from '../../lib/throttle.js';

// إنشاء أول مدير للمنصة. يعمل مرة واحدة فقط، ويحتاج SETUP_KEY.
export async function onRequestPost({ request, env }) {
  if (!env.SETUP_KEY) return fail(500, 'المتغير SETUP_KEY غير مضبوط');
  const ip = clientIp(request);
  const key = `setup:${ip}`;
  if (await isLocked(env.DB, key, 5)) return fail(429, 'محاولات كثيرة فاشلة. حاول بعد 15 دقيقة');

  const b = await readJson(request);
  if (!b || !(await safeEqual(b.key, env.SETUP_KEY))) {
    await recordFailure(env.DB, key);
    return fail(403, 'مفتاح الإعداد غير صحيح');
  }

  const exists = await env.DB.prepare(`SELECT 1 AS x FROM users WHERE role = 'platform_admin' LIMIT 1`).first();
  if (exists) return fail(409, 'تم إنشاء مدير المنصة مسبقًا');

  const email = String(b.email || '').trim().toLowerCase();
  const name = String(b.name || '').trim();
  const password = String(b.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || name.length < 2 || name.length > 80) return fail(400, 'البريد أو الاسم غير صحيح');
  const problem = passwordProblem(password, email, name);
  if (problem) return fail(400, problem);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES (?, NULL, ?, ?, ?, 'platform_admin')`
  )
    .bind(id, email, name, await hashPassword(password))
    .run();
  await auditRaw(env.DB, { user_id: id, action: 'platform.setup', ip });
  return json({ ok: true }, 201);
}
