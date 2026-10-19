import { can, fail, json, readJson } from '../../../lib/http.js';
import { repoFor } from '../../../lib/repo.js';

const STATUSES = ['done', 'cancelled', 'no_show'];

export async function onRequestPatch({ request, params, env, data }) {
  if (!can(data.auth, 'admin', 'reception', 'doctor')) return fail(403, 'غير مسموح');
  const b = await readJson(request);
  if (!b || !STATUSES.includes(b.status)) return fail(400, 'الحالة غير صحيحة');

  const repo = repoFor(env, data.auth);
  const appt = await repo.appointments.get(params.id);
  // نفس الرد سواء لم يوجد الموعد أو كان في مستشفى آخر
  if (!appt) return fail(404, 'الموعد غير موجود');
  if (appt.status !== 'scheduled') return fail(409, 'لا يمكن تعديل موعد منتهٍ أو ملغى');

  // الطبيب يعدّل مواعيده فقط، ولا يلغي (الإلغاء للاستقبال والمدير)
  if (data.auth.role === 'doctor' && (appt.doctor_id !== data.auth.uid || b.status === 'cancelled')) {
    return fail(403, 'غير مسموح');
  }

  await repo.appointments.setStatus(params.id, b.status);
  return json({ ok: true });
}
