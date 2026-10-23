import { fail, json, readJson } from '../../../lib/http.js';
import { has } from '../../../lib/permissions.js';
import { repoFor } from '../../../lib/repo.js';
import { parsePatient } from '../../../lib/validate.js';

export async function onRequestGet({ request, env, data }) {
  if (!has(data.auth, 'patients.read')) return fail(403, 'غير مسموح');
  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 60);
  return json({ patients: await repoFor(env, data.auth).patients.list(q) });
}

export async function onRequestPost({ request, env, data }) {
  if (!has(data.auth, 'patients.create')) return fail(403, 'غير مسموح');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');
  const parsed = parsePatient(b);
  if (parsed.error) return fail(400, parsed.error);

  const repo = repoFor(env, data.auth);
  const created = await repo.patients.create(parsed.value);
  await repo.audit.log('patient.create', created.id);
  return json(created, 201);
}
