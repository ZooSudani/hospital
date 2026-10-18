import { hashPassword } from '../../../lib/auth.js';
import { can, fail, json, readJson } from '../../../lib/http.js';
import { repoFor } from '../../../lib/repo.js';

const ROLES = ['admin', 'doctor', 'reception', 'accountant'];

export async function onRequestPatch({ request, params, env, data }) {
  if (!can(data.auth, 'admin')) return fail(403, 'لمدير المستشفى فقط');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');

  const repo = repoFor(env, data.auth);
  const target = await repo.staff.get(params.id);
  // نفس الرد سواء لم يوجد الموظف أو كان في مستشفى آخر
  if (!target) return fail(404, 'الموظف غير موجود');

  const fields = {};
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (name.length < 2 || name.length > 80) return fail(400, 'الاسم من 2 إلى 80 حرفًا');
    fields.name = name;
  }
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return fail(400, 'الدور غير صحيح');
    fields.role = b.role;
  }
  if (b.active !== undefined) fields.active = b.active ? 1 : 0;
  if (b.password !== undefined) {
    if (String(b.password).length < 8) return fail(400, 'كلمة المرور 8 أحرف على الأقل');
    fields.password_hash = await hashPassword(String(b.password));
  }

  // لا يوقف المدير نفسه ولا يغيّر دوره، حتى لا يُقفل المستشفى على نفسه
  if (target.id === data.auth.uid && (fields.active === 0 || (fields.role && fields.role !== target.role))) {
    return fail(400, 'لا يمكنك إيقاف حسابك أو تغيير دورك');
  }

  await repo.staff.update(params.id, fields);
  return json({ ok: true });
}
