import { fail, json, readJson } from '../../../../lib/http.js';
import { has, normalizeOverrides, permissionsInfo } from '../../../../lib/permissions.js';
import { repoFor } from '../../../../lib/repo.js';

// عرض صلاحيات موظف وتخصيصها. من يملك staff.manage فقط، بالقيود التالية:
//  - لا يعدّل أحد صلاحياته بنفسه، ولا يرفع نفسه بطريق ملتوٍ.
//  - صلاحيات المديرين يعدّلها مدير المنصة وحده.
//  - الصلاحيات الحساسة (إدارة الموظفين، سجل النشاط) لا يمنحها إلا مدير المنصة.
export async function onRequestGet({ params, env, data }) {
  if (!has(data.auth, 'staff.manage')) return fail(403, 'غير مسموح');
  const target = await repoFor(env, data.auth).staff.getAccess(params.id);
  if (!target) return fail(404, 'الموظف غير موجود');
  return json({
    name: target.name,
    editable: target.id !== data.auth.uid && target.role !== 'admin',
    ...permissionsInfo(target.role, target.perm_overrides, { callerIsPlatform: false }),
  });
}

export async function onRequestPut({ request, params, env, data }) {
  if (!has(data.auth, 'staff.manage')) return fail(403, 'غير مسموح');
  const repo = repoFor(env, data.auth);
  const target = await repo.staff.getAccess(params.id);
  if (!target) return fail(404, 'الموظف غير موجود');
  if (target.id === data.auth.uid) return fail(403, 'لا يمكنك تعديل صلاحياتك بنفسك');
  if (target.role === 'admin') return fail(403, 'صلاحيات المديرين يعدّلها مدير المنصة فقط');

  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');
  const norm = normalizeOverrides(b, target.role, { callerIsPlatform: false });
  if (norm.error) return fail(400, norm.error);

  const { grant, deny } = norm.value;
  await repo.staff.setOverrides(target.id, grant.length || deny.length ? JSON.stringify(norm.value) : null);
  await repo.audit.log('staff.permissions', target.id, `+${grant.length} -${deny.length}`);
  return json({ ok: true });
}
