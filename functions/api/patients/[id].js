import { can, fail, json } from '../../../lib/http.js';
import { repoFor } from '../../../lib/repo.js';

export async function onRequestGet({ params, env, data }) {
  if (!can(data.auth, 'admin', 'doctor', 'reception', 'accountant')) return fail(403, 'غير مسموح');
  const patient = await repoFor(env, data.auth).patients.get(params.id);
  // نفس الرد سواء لم يوجد المريض أو كان في مستشفى آخر
  if (!patient) return fail(404, 'المريض غير موجود');
  return json({ patient });
}
