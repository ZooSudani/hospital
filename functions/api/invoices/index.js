import { fail, json, readJson } from '../../../lib/http.js';
import { has } from '../../../lib/permissions.js';
import { repoFor } from '../../../lib/repo.js';

export async function onRequestGet({ request, env, data }) {
  if (!has(data.auth, 'invoices.read')) return fail(403, 'غير مسموح');
  const patientId = new URL(request.url).searchParams.get('patient_id');
  return json({ invoices: await repoFor(env, data.auth).invoices.list(patientId) });
}

export async function onRequestPost({ request, env, data }) {
  if (!has(data.auth, 'invoices.create')) return fail(403, 'غير مسموح');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');
  const total = Number(b.total);
  if (!Number.isInteger(total) || total < 1 || total > 1_000_000_000) return fail(400, 'المبلغ رقم صحيح موجب');

  const repo = repoFor(env, data.auth);
  const patient = await repo.patients.get(String(b.patient_id || ''));
  if (!patient) return fail(400, 'المريض غير موجود');
  const created = await repo.invoices.create({ patient_id: patient.id, total });
  await repo.audit.log('invoice.create', created.id.slice(0, 8), String(total));
  return json(created, 201);
}
