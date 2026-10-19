import { can, fail, json, readJson } from '../../../lib/http.js';
import { repoFor } from '../../../lib/repo.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayKhartoum = () => new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10); // توقيت السودان UTC+2

// يقبل "YYYY-MM-DD HH:MM" أو "YYYY-MM-DDTHH:MM"، ويشترط أن تكون الدقائق 00 أو 15 أو 30 أو 45
function normalizeSlot(v) {
  const s = String(v || '').trim().replace('T', ' ').slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return null;
  const d = new Date(`${s.replace(' ', 'T')}:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 16).replace('T', ' ') !== s) return null;
  return [0, 15, 30, 45].includes(d.getUTCMinutes()) ? s : null;
}

export async function onRequestGet({ request, env, data }) {
  if (!can(data.auth, 'admin', 'reception', 'doctor')) return fail(403, 'غير مسموح');
  const date = new URL(request.url).searchParams.get('date') || todayKhartoum();
  if (!DATE.test(date)) return fail(400, 'التاريخ بصيغة YYYY-MM-DD');
  const doctorOnly = data.auth.role === 'doctor' ? data.auth.uid : null;
  return json({ date, appointments: await repoFor(env, data.auth).appointments.list(date, doctorOnly) });
}

export async function onRequestPost({ request, env, data }) {
  if (!can(data.auth, 'admin', 'reception')) return fail(403, 'غير مسموح');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');

  const starts_at = normalizeSlot(b.starts_at);
  if (!starts_at) return fail(400, 'الموعد بصيغة صحيحة، وبدقائق 00 أو 15 أو 30 أو 45');
  const reason = b.reason ? String(b.reason).trim().slice(0, 200) : null;

  const repo = repoFor(env, data.auth);
  const patient = await repo.patients.get(String(b.patient_id || ''));
  if (!patient) return fail(400, 'المريض غير موجود');
  const doctor = await repo.staff.get(String(b.doctor_id || ''));
  if (!doctor || doctor.role !== 'doctor' || !doctor.active) return fail(400, 'الطبيب غير موجود أو غير فعّال');

  try {
    const created = await repo.appointments.create({ patient_id: patient.id, doctor_id: doctor.id, starts_at, reason });
    return json(created, 201);
  } catch (e) {
    // الفهرس الفريد (tenant_id, doctor_id, starts_at) للمواعيد المحجوزة يمنع الحجز المزدوج في القاعدة نفسها
    if (String(e).includes('UNIQUE')) return fail(409, 'هذا الوقت محجوز للطبيب. اختر وقتًا آخر');
    throw e;
  }
}
