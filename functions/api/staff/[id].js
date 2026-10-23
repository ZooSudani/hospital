import { hashPassword, passwordProblem } from '../../../lib/auth.js';
import { has } from '../../../lib/permissions.js';
import { fail, json, readJson } from '../../../lib/http.js';
import { repoFor } from '../../../lib/repo.js';

const ROLES = ['admin', 'doctor', 'reception', 'accountant'];

export async function onRequestPatch({ request, params, env, data }) {
  if (!has(data.auth, 'staff.manage')) return fail(403, 'غير مسموح');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');

  const repo = repoFor(env, data.auth);
  const target = await repo.staff.get(params.id);
  // نفس الرد سواء لم يوجد الموظف أو كان في مستشفى آخر
  if (!target) return fail(404, 'الموظف غير موجود');
  // حسابات المديرين لا يعدّلها إلا مدير فعلي
  if (target.role === 'admin' && data.auth.role !== 'admin') return fail(403, 'حسابات المديرين لمديري المستشفى فقط');

  const fields = {};
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (name.length < 2 || name.length > 80) return fail(400, 'الاسم من 2 إلى 80 حرفًا');
    fields.name = name;
  }
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return fail(400, 'الدور غير صحيح');
    if (b.role === 'admin' && data.auth.role !== 'admin') return fail(403, 'الترقية إلى مدير لمديري المستشفى فقط');
    fields.role = b.role;
    // تغيير الدور يصفّر التخصيصات، لأنها كانت مبنية على صلاحيات الدور القديم
    if (b.role !== target.role) fields.perm_overrides = null;
  }
  if (b.active !== undefined) fields.active = b.active ? 1 : 0;
  if (b.password !== undefined) {
    const problem = passwordProblem(b.password, target.email, target.name);
    if (problem) return fail(400, problem);
    fields.password_hash = await hashPassword(String(b.password));
  }

  // لا يوقف المدير نفسه ولا يغيّر دوره، حتى لا يُقفل المستشفى على نفسه
  if (target.id === data.auth.uid && (fields.active === 0 || (fields.role && fields.role !== target.role))) {
    return fail(400, 'لا يمكنك إيقاف حسابك أو تغيير دورك');
  }

  await repo.staff.update(params.id, fields);
  // نسجّل أسماء الحقول المعدّلة فقط، وكلمة المرور تُذكر دون قيمتها
  await repo.audit.log('staff.update', params.id, Object.keys(fields).map((k) => (k === 'password_hash' ? 'password' : k)).join(','));
  return json({ ok: true });
}
