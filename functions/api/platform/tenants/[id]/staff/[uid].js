import { hashPassword, passwordProblem } from '../../../../../../lib/auth.js';
import { auditRaw } from '../../../../../../lib/audit.js';
import { can, fail, json, readJson } from '../../../../../../lib/http.js';

const ROLES = ['admin', 'doctor', 'reception', 'accountant'];

// تعديل حساب موظف في أي مستشفى: إيقاف/تفعيل، كلمة مرور، دور، اسم، فك قفل. لمدير المنصة فقط.
export async function onRequestPatch({ request, params, env, data }) {
  if (!can(data.auth, 'platform_admin')) return fail(403, 'للمدير العام للمنصة فقط');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');

  const tenant = await env.DB.prepare(`SELECT id, slug FROM tenants WHERE id = ?`).bind(params.id).first();
  if (!tenant) return fail(404, 'المستشفى غير موجود');
  // الموظف يجب أن يتبع المستشفى في المسار، فلا يُعدَّل موظف مستشفى آخر بالخطأ
  const user = await env.DB.prepare(`SELECT id, name, email, role, active FROM users WHERE id = ? AND tenant_id = ?`).bind(params.uid, tenant.id).first();
  if (!user) return fail(404, 'الموظف غير موجود');

  const sets = [];
  const args = [];
  const changed = [];
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (name.length < 2 || name.length > 80) return fail(400, 'الاسم من 2 إلى 80 حرفًا');
    sets.push('name = ?'); args.push(name); changed.push('name');
  }
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return fail(400, 'الدور غير صحيح');
    sets.push('role = ?'); args.push(b.role); changed.push('role');
    if (b.role !== user.role) sets.push('perm_overrides = NULL'); // تغيير الدور يصفّر التخصيصات القديمة
  }
  if (b.active !== undefined) { sets.push('active = ?'); args.push(b.active ? 1 : 0); changed.push('active'); }
  if (b.password !== undefined) {
    const problem = passwordProblem(b.password, user.email, user.name);
    if (problem) return fail(400, problem);
    sets.push('password_hash = ?', 'token_version = token_version + 1'); args.push(await hashPassword(String(b.password))); changed.push('password');
  }

  // لا يُترك مستشفى بلا مدير فعّال
  const losesAdmin = user.role === 'admin' && user.active && ((b.active !== undefined && !b.active) || (b.role !== undefined && b.role !== 'admin'));
  if (losesAdmin) {
    const others = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND role = 'admin' AND active = 1 AND id <> ?`).bind(tenant.id, user.id).first();
    if (!others.n) return fail(400, 'لا يمكن إيقاف آخر مدير فعّال في المستشفى أو تخفيض دوره');
  }

  if (sets.length) {
    await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...args, user.id, tenant.id).run();
  }
  if (b.unlock === true || b.password !== undefined) {
    await env.DB.prepare(`DELETE FROM login_attempts WHERE key = ?`).bind(`u:${tenant.slug}:${user.email}`).run();
    if (b.unlock === true) changed.push('unlock');
  }
  if (!changed.length) return fail(400, 'لا يوجد ما يُعدَّل');

  await auditRaw(env.DB, { tenant_id: tenant.id, user_id: data.auth.uid, action: 'staff.update', target: user.id, detail: changed.join(','), ip: data.auth.ip });
  return json({ ok: true });
}
