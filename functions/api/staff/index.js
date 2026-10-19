import { hashPassword } from '../../../lib/auth.js';
import { can, fail, json, readJson } from '../../../lib/http.js';
import { repoFor } from '../../../lib/repo.js';

const STAFF_ROLES = ['admin', 'doctor', 'reception', 'accountant'];

export async function onRequestGet({ request, env, data }) {
  // قائمة مختصرة بالأطباء الفعّالين (اسم ومعرّف فقط) لحجز المواعيد
  if (new URL(request.url).searchParams.get('role') === 'doctor') {
    if (!can(data.auth, 'admin', 'reception')) return fail(403, 'غير مسموح');
    return json({ doctors: await repoFor(env, data.auth).staff.listDoctors() });
  }
  if (!can(data.auth, 'admin')) return fail(403, 'لمدير المستشفى فقط');
  return json({ staff: await repoFor(env, data.auth).staff.list() });
}

export async function onRequestPost({ request, env, data }) {
  if (!can(data.auth, 'admin')) return fail(403, 'لمدير المستشفى فقط');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');

  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const role = String(b.role || '');

  if (name.length < 2 || name.length > 80) return fail(400, 'الاسم من 2 إلى 80 حرفًا');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'البريد الإلكتروني غير صحيح');
  if (password.length < 8) return fail(400, 'كلمة المرور 8 أحرف على الأقل');
  if (!STAFF_ROLES.includes(role)) return fail(400, 'الدور غير صحيح');

  try {
    const created = await repoFor(env, data.auth).staff.create({
      name, email, role, password_hash: await hashPassword(password),
    });
    return json(created, 201);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail(409, 'هذا البريد مستخدم في المستشفى');
    throw e;
  }
}
