import { verifyToken } from '../lib/auth.js';
import { clientIp, fail } from '../lib/http.js';

const PUBLIC = new Set(['/api/auth/login', '/api/setup']);
const HARDEN = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };

// يتحقق من التوكن ثم من حالة المستخدم في القاعدة في كل طلب، فلا يُعتمد على ما داخل التوكن وحده.
async function authenticate(request, env) {
  if (!env.JWT_SECRET || String(env.JWT_SECRET).length < 32) return fail(500, 'المتغير JWT_SECRET غير مضبوط أو ضعيف (32 حرفًا على الأقل)');
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const claims = token ? await verifyToken(token, env.JWT_SECRET) : null;
  if (!claims) return fail(401, 'غير مصرح. سجّل الدخول مرة أخرى');

  const ip = clientIp(request);

  if (claims.tid) {
    const row = await env.DB.prepare(
      `SELECT t.status AS tstatus, u.active AS uactive, u.role AS role, u.token_version AS tv
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = ? AND u.tenant_id = ?`
    )
      .bind(claims.sub, claims.tid)
      .first();
    if (!row || row.tv !== claims.tv) return fail(401, 'انتهت الجلسة. سجّل الدخول مرة أخرى'); // تغيّرت كلمة المرور أو حُذف الحساب
    if (row.tstatus !== 'active' || !row.uactive) return fail(403, 'الحساب أو المستشفى غير فعّال');
    return { uid: claims.sub, tid: claims.tid, role: row.role, ip };
  }

  // مدير المنصة يُفحص هو الآخر في القاعدة (فعّال، وما زال بدور مدير المنصة، ولم تتغير كلمة مروره)
  const row = await env.DB.prepare(
    `SELECT active, role, token_version AS tv FROM users WHERE id = ? AND tenant_id IS NULL AND role = 'platform_admin'`
  )
    .bind(claims.sub)
    .first();
  if (!row || row.tv !== claims.tv) return fail(401, 'انتهت الجلسة. سجّل الدخول مرة أخرى');
  if (!row.active) return fail(403, 'الحساب غير فعّال');
  return { uid: claims.sub, tid: null, role: row.role, ip };
}

export async function onRequest({ request, env, next, data }) {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith('/api/')) return next();

  let res;
  try {
    if (PUBLIC.has(pathname)) {
      res = await next();
    } else {
      const auth = await authenticate(request, env);
      if (auth instanceof Response) res = auth;
      else { data.auth = auth; res = await next(); }
    }
  } catch (e) {
    // خطأ الحارس (IsolationError) أو أي خلل داخلي: يُسجَّل ولا تُكشف تفاصيله للمستخدم
    console.error('request failed', e?.code || '', e?.message || e);
    res = fail(500, 'خطأ داخلي في الخادم');
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(HARDEN)) out.headers.set(k, v);
  return out;
}
