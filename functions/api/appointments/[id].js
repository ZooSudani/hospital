import { fail, json, readJson } from '../../../lib/http.js';
import { has } from '../../../lib/permissions.js';
import { repoFor } from '../../../lib/repo.js';

const STATUSES = ['done', 'cancelled', 'no_show'];

export async function onRequestPatch({ request, params, env, data }) {
  if (!has(data.auth, 'appointments.complete') && !has(data.auth, 'appointments.cancel')) return fail(403, 'غير مسموح');
  const b = await readJson(request);
  if (!b || !STATUSES.includes(b.status)) return fail(400, 'الحالة غير صحيحة');
  // الإلغاء صلاحية مستقلة عن تسجيل الحضور والغياب
  if (!has(data.auth, b.status === 'cancelled' ? 'appointments.cancel' : 'appointments.complete')) return fail(403, 'غير مسموح');

  const repo = repoFor(env, data.auth);
  const appt = await repo.appointments.get(params.id);
  // نفس الرد سواء لم يوجد الموعد أو كان في مستشفى آخر
  if (!appt) return fail(404, 'الموعد غير موجود');
  if (appt.status !== 'scheduled') return fail(409, 'لا يمكن تعديل موعد منتهٍ أو ملغى');

  // من لا يملك appointments.all يتعامل مع مواعيده هو فقط
  if (!has(data.auth, 'appointments.all') && appt.doctor_id !== data.auth.uid) return fail(403, 'غير مسموح');

  await repo.appointments.setStatus(params.id, b.status);
  await repo.audit.log('appointment.status', params.id, b.status);
  return json({ ok: true });
}
