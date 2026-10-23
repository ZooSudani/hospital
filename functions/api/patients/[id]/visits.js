import { fail, json, readJson } from '../../../../lib/http.js';
import { has } from '../../../../lib/permissions.js';
import { repoFor } from '../../../../lib/repo.js';

// السجل الطبي للمريض. القراءة والكتابة بصلاحيتين منفصلتين، وكل قراءة تُسجَّل في سجل النشاط.
export async function onRequestGet({ params, env, data }) {
  if (!has(data.auth, 'visits.read')) return fail(403, 'غير مسموح');
  const repo = repoFor(env, data.auth);
  const patient = await repo.patients.get(params.id);
  if (!patient) return fail(404, 'المريض غير موجود');
  const visits = await repo.visits.list(patient.id);
  await repo.audit.log('visit.view', patient.id, String(visits.length));
  return json({ patient: { id: patient.id, full_name: patient.full_name, file_no: patient.file_no }, visits });
}

export async function onRequestPost({ request, params, env, data }) {
  if (!has(data.auth, 'visits.write')) return fail(403, 'غير مسموح');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');
  const clean = (v) => (v ? String(v).trim().slice(0, 2000) : null);
  const diagnosis = clean(b.diagnosis), notes = clean(b.notes), prescription = clean(b.prescription);
  if (!diagnosis && !notes && !prescription) return fail(400, 'اكتب التشخيص أو الملاحظات أو الوصفة');

  const repo = repoFor(env, data.auth);
  const patient = await repo.patients.get(params.id);
  if (!patient) return fail(404, 'المريض غير موجود');

  // الزيارة قد ترتبط بموعد، بشرط أن يكون لنفس المريض
  let appointment_id = null;
  if (b.appointment_id) {
    const appt = await repo.appointments.get(String(b.appointment_id));
    if (!appt || appt.patient_id !== patient.id) return fail(400, 'الموعد غير موجود لهذا المريض');
    appointment_id = appt.id;
  }
  // الكاتب هو المستخدم الحالي دائمًا، ولا يُقبل اسم كاتب من الطلب
  const created = await repo.visits.create({ patient_id: patient.id, doctor_id: data.auth.uid, appointment_id, diagnosis, notes, prescription });
  await repo.audit.log('visit.create', patient.id, created.id.slice(0, 8));
  return json(created, 201);
}
