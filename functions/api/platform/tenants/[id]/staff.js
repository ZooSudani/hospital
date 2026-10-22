import { hashPassword, passwordProblem } from '../../../../../lib/auth.js';
import { auditRaw } from '../../../../../lib/audit.js';
import { can, fail, json, readJson } from '../../../../../lib/http.js';

const ROLES = ['admin', 'doctor', 'reception', 'accountant'];

// موظفو مستشفى معيّن: يعرضهم مدير المنصة ويضيف إليهم. لمدير المنصة فقط.
// الاستعلامات هنا تحدد المستشفى صراحة من المسار (المنصة تتجاوز عزل المستشفى عمدًا، ولا تلمس بيانات المرضى).
export async function onRequestGet({ params, env, data }) {
  if (!can(data.auth, 'platform_admin')) return fail(403, 'للمدير العام للمنصة فقط');
  const tenant = await env.DB.prepare(`SELECT id FROM tenants WHERE id = ?`).bind(params.id).first();
  if (!tenant) return fail(404, 'المستشفى غير موجود');
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at,
            (SELECT MAX(a.created_at) FROM audit_log a WHERE a.tenant_id = u.tenant_id AND a.user_id = u.id AND a.action = 'login.ok') AS last_login
     FROM users u WHERE u.tenant_id = ? ORDER BY u.created_at`
  )
    .bind(tenant.id)
    .all();
  return json({ staff: results });
}

export async function onRequestPost({ request, params, env, data }) {
  if (!can(data.auth, 'platform_admin')) return fail(403, 'للمدير العام للمنصة فقط');
  const tenant = await env.DB.prepare(`SELECT id, status FROM tenants WHERE id = ?`).bind(params.id).first();
  if (!tenant) return fail(404, 'المستشفى غير موجود');
  const b = await readJson(request);
  if (!b) return fail(400, 'طلب غير صالح');

  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const role = String(b.role || '');
  if (name.length < 2 || name.length > 80) return fail(400, 'الاسم من 2 إلى 80 حرفًا');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'البريد الإلكتروني غير صحيح');
  if (!ROLES.includes(role)) return fail(400, 'الدور غير صحيح');
  const problem = passwordProblem(password, email, name);
  if (problem) return fail(400, problem);

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(`INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, tenant.id, email, name, await hashPassword(password), role)
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail(409, 'هذا البريد مستخدم في المستشفى');
    throw e;
  }
  await auditRaw(env.DB, { tenant_id: tenant.id, user_id: data.auth.uid, action: 'staff.create', target: id, detail: role, ip: data.auth.ip });
  return json({ id }, 201);
}
