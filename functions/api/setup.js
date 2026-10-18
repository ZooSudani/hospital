import { hashPassword } from '../../lib/auth.js';
import { fail, json, readJson } from '../../lib/http.js';

// إنشاء أول مدير للمنصة. يعمل مرة واحدة فقط، ويحتاج SETUP_KEY.
export async function onRequestPost({ request, env }) {
  if (!env.SETUP_KEY) return fail(500, 'المتغير SETUP_KEY غير مضبوط');
  const b = await readJson(request);
  if (!b || b.key !== env.SETUP_KEY) return fail(403, 'مفتاح الإعداد غير صحيح');

  const exists = await env.DB.prepare(`SELECT 1 AS x FROM users WHERE role = 'platform_admin' LIMIT 1`).first();
  if (exists) return fail(409, 'تم إنشاء مدير المنصة مسبقًا');

  const email = String(b.email || '').trim().toLowerCase();
  const name = String(b.name || '').trim();
  const password = String(b.password || '');
  if (!email.includes('@') || name.length < 2 || password.length < 8) {
    return fail(400, 'البريد أو الاسم أو كلمة المرور (8 أحرف على الأقل) غير صحيح');
  }

  await env.DB.prepare(
    `INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES (?, NULL, ?, ?, ?, 'platform_admin')`
  )
    .bind(crypto.randomUUID(), email, name, await hashPassword(password))
    .run();
  return json({ ok: true }, 201);
}
