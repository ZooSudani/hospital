// اختبارات الأمان: التخمين، الجلسات، الصلاحيات، سجل النشاط، تسريب الأخطاء، وحجم الطلب.
import assert from 'node:assert/strict';
import { makeDb } from './d1-shim.js';
import { signToken } from '../lib/auth.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequestPost as setup } from '../functions/api/setup.js';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { onRequestPost as createTenant } from '../functions/api/platform/tenants.js';
import { onRequestGet as listPatients, onRequestPost as addPatient } from '../functions/api/patients/index.js';
import { onRequestGet as getPatient } from '../functions/api/patients/[id].js';
import { onRequestPost as addStaff } from '../functions/api/staff/index.js';
import { onRequestPatch as patchStaff } from '../functions/api/staff/[id].js';
import { onRequestGet as listAudit } from '../functions/api/audit.js';

const SECRET = 'security-test-secret-'.padEnd(48, 'x');
const env = { DB: makeDb(), JWT_SECRET: SECRET, SETUP_KEY: 'setup-key-1' };
const raw = env.DB.raw;

const call = async (handler, { path = '/api/x', method = 'GET', body, token, params = {}, ip, rawBody, headers = {}, e = env } = {}) => {
  const request = new Request(`https://x.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(ip ? { 'cf-connecting-ip': ip } : {}), ...headers },
    body: rawBody ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = {};
  const res = await middleware({ request, env: e, data, next: async () => handler({ request, env: e, data, params }) });
  return { status: res.status, body: await res.json(), headers: res.headers };
};
const post = (handler, path, body, opts = {}) => call(handler, { path, method: 'POST', body, ...opts });
const loginReq = (slug, email, password, ip) => post(login, '/api/auth/login', { slug, email, password }, { ip });

// ===== تجهيز =====
assert.equal((await post(setup, '/api/setup', { key: 'wrong', email: 'r@x.com', name: 'مدير', password: 'Zebra-5521-kx' }, { ip: '9.9.9.9' })).status, 403);
assert.equal((await post(setup, '/api/setup', { key: 'setup-key-1', email: 'root@x.com', name: 'مدير', password: 'rootpass99' }, { ip: '1.1.1.1' })).status, 400, 'كلمة مرور تحوي جزءًا من البريد');
assert.equal((await post(setup, '/api/setup', { key: 'setup-key-1', email: 'root@x.com', name: 'مدير', password: '12345678' }, { ip: '1.1.1.1' })).status, 400, 'كلمة مرور شائعة');
assert.equal((await post(setup, '/api/setup', { key: 'setup-key-1', email: 'root@x.com', name: 'مدير المنصة', password: 'Zebra-5521-kx' }, { ip: '1.1.1.1' })).status, 201);
let platform = (await loginReq('platform', 'root@x.com', 'Zebra-5521-kx', '1.1.1.1')).body.token;

for (const slug of ['alnoor', 'alamal']) {
  const r = await post(createTenant, '/api/platform/tenants', { name: `مستشفى ${slug}`, slug, admin_email: `admin@${slug}.com`, admin_name: `مدير ${slug}`, admin_password: 'Hospital-8842' }, { token: platform });
  assert.equal(r.status, 201, JSON.stringify(r.body));
}
assert.equal((await post(createTenant, '/api/platform/tenants', { name: 'ضعيف', slug: 'weakpw', admin_email: 'a@weak.com', admin_name: 'مدير', admin_password: '11111111' }, { token: platform })).status, 400, 'سياسة كلمة المرور عند إنشاء مستشفى');

const adminNoor = (await loginReq('alnoor', 'admin@alnoor.com', 'Hospital-8842', '2.2.2.2')).body.token;
const adminAmal = (await loginReq('alamal', 'admin@alamal.com', 'Hospital-8842', '2.2.2.3')).body.token;
const mk = (token, name, email, role) => post(addStaff, '/api/staff', { name, email, password: 'Staff-pass-7731', role }, { token });
const docId = (await mk(adminNoor, 'د. هالة', 'hala@alnoor.com', 'doctor')).body.id;
const recId = (await mk(adminNoor, 'ريم', 'reem@alnoor.com', 'reception')).body.id;
const accId = (await mk(adminNoor, 'عمر', 'omar@alnoor.com', 'accountant')).body.id;
const tokenFor = async (email, ip = '3.3.3.3') => (await loginReq('alnoor', email, 'Staff-pass-7731', ip)).body.token;
const doctor = await tokenFor('hala@alnoor.com');
const reception = await tokenFor('reem@alnoor.com');
const accountant = await tokenFor('omar@alnoor.com');

// ===== 1) الصلاحيات في الخادم (وليس في الواجهة فقط) =====
const newPatient = (token, name = 'مريض اختبار') => post(addPatient, '/api/patients', { full_name: name, phone: '0911111111' }, { token });
assert.equal((await newPatient(doctor)).status, 403, 'الطبيب لا يسجل مريضًا');
assert.equal((await newPatient(accountant)).status, 403, 'المحاسب لا يسجل مريضًا');
assert.equal((await newPatient(reception)).status, 201, 'الاستقبال يسجل');
assert.equal((await newPatient(adminNoor, 'مريض ثانٍ')).status, 201, 'المدير يسجل');
assert.equal((await call(listPatients, { token: doctor })).status, 200, 'الطبيب يقرأ');
assert.equal((await call(listPatients, { token: accountant })).status, 200, 'المحاسب يقرأ');
assert.equal((await call(listPatients, { token: platform })).status, 403, 'مدير المنصة لا يرى المرضى');
assert.equal((await call(listPatients, {})).status, 401, 'بلا توكن');

// ===== 2) تحديد محاولات التخمين =====
const victimIp = '5.5.5.5';
for (let i = 0; i < 5; i++) assert.equal((await loginReq('alnoor', 'reem@alnoor.com', 'wrong-guess-' + i, victimIp)).status, 401);
let r = await loginReq('alnoor', 'reem@alnoor.com', 'Staff-pass-7731', victimIp);
assert.equal(r.status, 429, 'بعد 5 محاولات فاشلة يُقفل الحساب حتى بكلمة المرور الصحيحة');
assert.equal((await loginReq('alnoor', 'reem@alnoor.com', 'Staff-pass-7731', '6.6.6.6')).status, 429, 'القفل على الحساب لا على العنوان فقط');
assert.equal((await loginReq('alnoor', 'hala@alnoor.com', 'Staff-pass-7731', '6.6.6.6')).status, 200, 'موظف آخر غير متأثر');
raw.prepare(`UPDATE login_attempts SET window_start = window_start - 1000 WHERE key LIKE 'u:%'`).run(); // مرور 15 دقيقة
assert.equal((await loginReq('alnoor', 'reem@alnoor.com', 'Staff-pass-7731', '6.6.6.6')).status, 200, 'يعود الدخول بعد انتهاء المدة');
assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE key = 'u:alnoor:reem@alnoor.com'`).get().n, 0, 'نجاح الدخول يصفّر العداد');

// قفل العنوان: 20 فشلًا ببريدات مختلفة
const sprayIp = '7.7.7.7';
for (let i = 0; i < 20; i++) await loginReq('alnoor', `ghost${i}@alnoor.com`, 'x-guess-' + i, sprayIp);
assert.equal((await loginReq('alnoor', 'new-ghost@alnoor.com', 'x-guess', sprayIp)).status, 429, 'رش كلمات المرور من عنوان واحد يُقفل');
assert.equal((await loginReq('alnoor', 'reem@alnoor.com', 'Staff-pass-7731', sprayIp)).status, 429, 'العنوان المقفول لا يدخل حتى بحساب صحيح');
assert.equal((await loginReq('alnoor', 'reem@alnoor.com', 'Staff-pass-7731', '8.8.8.8')).status, 200, 'عنوان آخر يدخل');

// مفتاح الإعداد محمي بالقفل أيضًا
for (let i = 0; i < 5; i++) await post(setup, '/api/setup', { key: 'bad' + i }, { ip: '4.4.4.4' });
assert.equal((await post(setup, '/api/setup', { key: 'setup-key-1' }, { ip: '4.4.4.4' })).status, 429);

// ===== 3) إبطال الجلسات =====
assert.equal((await call(listPatients, { token: doctor })).status, 200);
assert.equal((await call(patchStaff, { method: 'PATCH', token: adminNoor, params: { id: docId }, body: { password: 'weak' } })).status, 400, 'سياسة كلمة المرور عند التغيير');
assert.equal((await call(patchStaff, { method: 'PATCH', token: adminNoor, params: { id: docId }, body: { password: 'Brand-new-pass-1' } })).status, 200);
assert.equal((await call(listPatients, { token: doctor })).status, 401, 'تغيير كلمة المرور يُسقط الجلسة القديمة');

// مدير المنصة يُفحص في القاعدة أيضًا
assert.equal((await call(listPatients, { path: '/api/platform/tenants', token: platform })).status, 403); // دور غير مناسب لكن الجلسة صالحة
raw.prepare(`UPDATE users SET active = 0 WHERE role = 'platform_admin'`).run();
assert.equal((await post(createTenant, '/api/platform/tenants', { name: 'x' }, { token: platform })).status, 403, 'مدير منصة موقوف يُمنع فورًا رغم صلاحية التوكن');
raw.prepare(`UPDATE users SET active = 1 WHERE role = 'platform_admin'`).run();
raw.prepare(`UPDATE users SET token_version = token_version + 1 WHERE role = 'platform_admin'`).run();
assert.equal((await post(createTenant, '/api/platform/tenants', { name: 'x' }, { token: platform })).status, 401, 'رفع الإصدار يسقط جلسة المنصة');
platform = (await loginReq('platform', 'root@x.com', 'Zebra-5521-kx', '1.1.1.1')).body.token;

// توكن بهوية مستخدم من مستشفى ومعرّف مستشفى آخر
const tenantAmal = raw.prepare(`SELECT id FROM tenants WHERE slug = 'alamal'`).get().id;
const mixed = await signToken({ sub: recId, tid: tenantAmal, role: 'admin', tv: 0 }, SECRET);
assert.equal((await call(listPatients, { token: mixed })).status, 401, 'هوية مختلطة بين مستشفيين تُرفض');
// توكن موقّع بسر مختلف
const forged = await signToken({ sub: recId, tid: raw.prepare(`SELECT tenant_id FROM users WHERE id = ?`).get(recId).tenant_id, role: 'admin', tv: 0 }, 'z'.repeat(48));
assert.equal((await call(listPatients, { token: forged })).status, 401, 'توكن بتوقيع مزوّر');
// توكن قديم بلا tv
const legacy = await signToken({ sub: recId, tid: raw.prepare(`SELECT tenant_id FROM users WHERE id = ?`).get(recId).tenant_id, role: 'reception' }, SECRET);
assert.equal((await call(listPatients, { token: legacy })).status, 401, 'توكن بلا إصدار يُرفض');
// الدور يؤخذ من القاعدة لا من التوكن
const tidNoor = raw.prepare(`SELECT tenant_id FROM users WHERE id = ?`).get(recId).tenant_id;
const lying = await signToken({ sub: accId, tid: tidNoor, role: 'admin', tv: 0 }, SECRET);
assert.equal((await newPatient(lying)).status, 403, 'ادعاء دور مدير داخل التوكن لا ينفع: المحاسب يبقى محاسبًا');

// ===== 4) حجم الطلب، والتحقق من المدخلات، وتسريب الأخطاء =====
assert.equal((await call(addPatient, { method: 'POST', token: reception, rawBody: JSON.stringify({ full_name: 'س'.repeat(30000) }) })).status, 400, 'طلب ضخم يُرفض');
assert.equal((await call(addPatient, { method: 'POST', token: reception, rawBody: '{bad json' })).status, 400);
assert.equal((await call(addPatient, { method: 'POST', token: reception, rawBody: '[1,2]' })).status, 400, 'مصفوفة بدل كائن');
r = await call(login, { path: '/api/auth/login', method: 'POST', body: { slug: 'alnoor', email: 'a@b.com', password: 'x' }, e: { JWT_SECRET: SECRET } });
assert.equal(r.status, 500, 'خطأ داخلي في نقطة عامة');
assert.equal(r.body.error, 'خطأ داخلي في الخادم', 'رسالة عامة بلا تفاصيل أو أسماء جداول');
assert.ok(!JSON.stringify(r.body).match(/DB|prepare|undefined|stack/i), 'لا تسريب تقني');
r = await call(listPatients, { token: reception, e: { ...env, JWT_SECRET: 'short' } });
assert.equal(r.status, 500, 'سر ضعيف يمنع التشغيل بدل أن يعمل بحماية هشة');

// الرؤوس الأمنية على ردود الواجهة
r = await call(listPatients, { token: reception });
assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
assert.equal(r.headers.get('cache-control'), 'no-store');
assert.equal(r.headers.get('referrer-policy'), 'no-referrer');

// ===== 5) البحث: محارف % و_ نص عادي =====
await newPatient(reception, 'ليلى 100% سودانية');
const search = async (q) => (await call(listPatients, { path: '/api/patients?q=' + encodeURIComponent(q), token: reception })).body.patients;
assert.equal((await search('%')).length, 1, 'علامة % تطابق الحرف نفسه فقط');
assert.equal((await search('_')).length, 0, 'علامة _ لا تطابق أي حرف');
assert.ok((await search('ليلى')).length === 1);

// ===== 6) سجل النشاط =====
const patientId = (await call(listPatients, { token: reception })).body.patients[0].id;
await call(getPatient, { token: doctor === null ? reception : reception, params: { id: patientId } });
let events = (await call(listAudit, { token: adminNoor })).body.events;
const actions = new Set(events.map((e) => e.action));
for (const a of ['login.ok', 'login.fail', 'patient.create', 'patient.view', 'staff.create', 'staff.update']) assert.ok(actions.has(a), 'مسجَّل: ' + a);
assert.ok(events.every((e) => e.tenant_id === undefined), 'لا يُرجع tenant_id للعميل');
assert.ok(!JSON.stringify(events).includes('Brand-new-pass-1') && !JSON.stringify(events).includes('Staff-pass-7731'), 'كلمات المرور لا تدخل السجل');
assert.ok(events.some((e) => e.action === 'staff.update' && e.detail === 'password'), 'تغيير كلمة المرور يُسجَّل بلا قيمتها');
assert.equal((await call(listAudit, { token: reception })).status, 403, 'الاستقبال لا يقرأ السجل');
assert.equal((await call(listAudit, { token: platform })).status, 403, 'مدير المنصة لا يقرأ سجل مستشفى');
const eventsAmal = (await call(listAudit, { token: adminAmal })).body.events;
assert.ok(!eventsAmal.some((e) => e.action === 'patient.create'), 'سجل مستشفى لا يظهر في مستشفى آخر');
assert.ok(raw.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'tenant.create'`).get().n === 2, 'إنشاء المستشفيات مسجَّل');

console.log('security: كل الاختبارات نجحت (6 مجموعات)');
