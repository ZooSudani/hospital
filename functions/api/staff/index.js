import { hashPassword, passwordProblem } from '../../../lib/auth.js';
import { has } from '../../../lib/permissions.js';
import { fail, json, readJson } from '../../../lib/http.js';
import { repoFor } from '../../../lib/repo.js';

const STAFF_ROLES = ['admin', 'doctor', 'reception', 'accountant'];

export async function onRequestGet({ request, env, data }) {
  // قائمة مختصرة بالأطباء الفعّالين (اسم ومعرّف فقط) لحجز المواعيد
  if (new URL(request.url).searchParams.get('role') === 'doctor') {
    if (!has(data.auth, 'appointments.book')) return fail(403, 'غير مسموح');
    return json({ doctors: await repoFor(env, data.auth).staff.listDoctors() });
  }
  if (!has(data.auth, 'staff.manage')) return fail(403, 'غير مسموح');
  return json({ staff: await repoFor(env, data.auth).staff.list() });
}

export async function onRequestPost({ request, env, data }) {
  if (!has(data.auth, 'staff.manage')) return fail(403, 'غير مسموح');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');

  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const role = String(b.role || '');

  if (name.length < 2 || name.length > 80) return fail(400, 'الاسم من 2 إلى 80 حرفًا');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'البريد الإلكتروني غير صحيح');
  const problem = passwordProblem(password, email, name);
  if (problem) return fail(400, problem);
  if (!STAFF_ROLES.includes(role)) return fail(400, 'الدور غير صحيح');
  // إنشاء مدير مستشفى لا يقوم به إلا مدير فعلي، فلا تكفي صلاحية إدارة الموظفين الممنوحة لغيره
  if (role === 'admin' && data.auth.role !== 'admin') return fail(403, 'إضافة مدير مستشفى لمديري المستشفى فقط');

  const repo = repoFor(env, data.auth);
  try {
    const created = await repo.staff.create({ name, email, role, password_hash: await hashPassword(password) });
    await repo.audit.log('staff.create', created.id, role);
    return json(created, 201);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail(409, 'هذا البريد مستخدم في المستشفى');
    throw e;
  }
}
