import { hashPassword, passwordProblem, signToken, verifyPassword } from '../../../lib/auth.js';
import { auditRaw } from '../../../lib/audit.js';
import { fail, json, readJson } from '../../../lib/http.js';
import { clearFailures, isLocked, recordFailure } from '../../../lib/throttle.js';

// تغيير كلمة مرور المستخدم لنفسه (أي دور،  ومنهم مدير المنصة).
// يتطلب كلمة المرور الحالية، فلا تكفي جلسة مسروقة لتغييرها. وينجح التغيير بجلسة جديدة تحل محل القديمة.
export async function onRequestPost({ request, env, data }) {
  const b = await readJson(request);
  const current = String(b?.current || '').slice(0, 200);
  const next = String(b?.next || '').slice(0, 200);
  if (!current || !next) return fail(400, 'أدخل كلمة المرور الحالية والجديدة');

  const a = data.auth;
  const lockKey = `pw:${a.uid}`;
  if (await isLocked(env.DB, lockKey, 5)) return fail(429, 'محاولات كثيرة فاشلة. حاول بعد 15 دقيقة');

  // `tenant_id IS ?` تعمل مع القيمة الفارغة (مدير المنصة) ومع معرّف المستشفى
  const user = await env.DB.prepare(
    `SELECT id, tenant_id, email, name, password_hash, role, token_version FROM users WHERE id = ? AND tenant_id IS ?`
  )
    .bind(a.uid, a.tid)
    .first();
  if (!user) return fail(401, 'انتهت الجلسة. سجّل الدخول مرة أخرى');

  if (!(await verifyPassword(current, user.password_hash))) {
    await recordFailure(env.DB, lockKey);
    return fail(400, 'كلمة المرور الحالية غير صحيحة');
  }
  if (current === next) return fail(400, 'كلمة المرور الجديدة يجب أن تختلف عن الحالية');
  const problem = passwordProblem(next, user.email, user.name);
  if (problem) return fail(400, problem);

  await env.DB.prepare(`UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ? AND tenant_id IS ?`)
    .bind(await hashPassword(next), user.id, a.tid)
    .run();
  await clearFailures(env.DB, lockKey);
  await auditRaw(env.DB, { tenant_id: user.tenant_id, user_id: user.id, action: 'account.password', ip: a.ip });

  const token = await signToken({ sub: user.id, tid: user.tenant_id, role: user.role, tv: user.token_version + 1 }, env.JWT_SECRET);
  return json({ ok: true, token });
}
