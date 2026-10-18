import { can, fail, json, readJson } from '../../../lib/http.js';
import { repoFor } from '../../../lib/repo.js';

const READ = ['admin', 'doctor', 'reception', 'accountant'];
const WRITE = ['admin', 'doctor', 'reception'];

export async function onRequestGet({ request, env, data }) {
  if (!can(data.auth, ...READ)) return fail(403, 'غير مسموح');
  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 60);
  const patients = await repoFor(env, data.auth).patients.list(q);
  return json({ patients });
}

export async function onRequestPost({ request, env, data }) {
  if (!can(data.auth, ...WRITE)) return fail(403, 'غير مسموح');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');

  const full_name = String(b.full_name || '').trim();
  const phone = b.phone ? String(b.phone).trim().slice(0, 30) : null;
  const birth_date = b.birth_date ? String(b.birth_date).trim() : null;
  const gender = b.gender || null;
  const notes = b.notes ? String(b.notes).trim().slice(0, 1000) : null;

  if (full_name.length < 3 || full_name.length > 120) return fail(400, 'الاسم من 3 إلى 120 حرفًا');
  if (birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(birth_date)) return fail(400, 'تاريخ الميلاد بصيغة YYYY-MM-DD');
  if (gender && !['male', 'female'].includes(gender)) return fail(400, 'الجنس غير صحيح');

  const created = await repoFor(env, data.auth).patients.create({ full_name, phone, birth_date, gender, notes });
  return json(created, 201);
}
