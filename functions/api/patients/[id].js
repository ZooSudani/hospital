import { fail, json, readJson } from '../../../lib/http.js';
import { has } from '../../../lib/permissions.js';
import { repoFor } from '../../../lib/repo.js';
import { parsePatient } from '../../../lib/validate.js';

export async function onRequestGet({ params, env, data }) {
  if (!has(data.auth, 'patients.read')) return fail(403, 'غير مسموح');
  const repo = repoFor(env, data.auth);
  const patient = await repo.patients.get(params.id);
  // نفس الرد سواء لم يوجد المريض أو كان في مستشفى آخر
  if (!patient) return fail(404, 'المريض غير موجود');
  await repo.audit.log('patient.view', patient.id); // فتح ملف مريض حدث حساس يُسجَّل
  return json({ patient });
}

export async function onRequestPatch({ request, params, env, data }) {
  if (!has(data.auth, 'patients.update')) return fail(403, 'غير مسموح');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');
  const parsed = parsePatient(b, { partial: true });
  if (parsed.error) return fail(400, parsed.error);
  if (!Object.keys(parsed.value).length) return fail(400, 'لا يوجد ما يُعدَّل');

  const repo = repoFor(env, data.auth);
  if (!(await repo.patients.get(params.id))) return fail(404, 'المريض غير موجود');
  await repo.patients.update(params.id, parsed.value);
  await repo.audit.log('patient.update', params.id, Object.keys(parsed.value).join(','));
  return json({ ok: true });
}
