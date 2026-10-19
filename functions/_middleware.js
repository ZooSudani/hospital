import { verifyToken } from '../lib/auth.js';
import { fail } from '../lib/http.js';

const PUBLIC = new Set(['/api/auth/login', '/api/setup']);

export async function onRequest({ request, env, next, data }) {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith('/api/') || PUBLIC.has(pathname)) return next();

  if (!env.JWT_SECRET) return fail(500, 'المتغير JWT_SECRET غير مضبوط');

  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const claims = token ? await verifyToken(token, env.JWT_SECRET) : null;
  if (!claims) return fail(401, 'غير مصرح. سجّل الدخول مرة أخرى');

  // المستخدم والمستشفى يجب أن يبقيا فعّالين حتى لو كان التوكن صالحًا
  if (claims.tid) {
    const row = await env.DB.prepare(
      `SELECT t.status AS tstatus, u.active AS uactive, u.role AS role
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = ? AND u.tenant_id = ?`
    )
      .bind(claims.sub, claims.tid)
      .first();
    if (!row || row.tstatus !== 'active' || !row.uactive) return fail(403, 'الحساب أو المستشفى غير فعّال');
    data.auth = { uid: claims.sub, tid: claims.tid, role: row.role };
  } else {
    data.auth = { uid: claims.sub, tid: null, role: claims.role };
  }
  try {
    return await next();
  } catch (e) {
    // خطأ الحارس (IsolationError) يعني خللًا برمجيًا في الاستعلام، فيُسجَّل ولا تُكشف تفاصيله للمستخدم
    console.error('request failed', e?.code || '', e?.message || e);
    return fail(500, 'خطأ داخلي في الخادم');
  }
}
