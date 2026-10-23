// اختبارات الأمان: التخمين، الجلسات، الصلاحيات، سجل النشاط، تسريب  الأخطاء، وحجم الطلب.
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
import { onRequestGet as listTenants } from '../functions/api/platform/tenants.js';
import { onRequestPatch as patchTenant } from '../functions/api/platform/tenants/[id].js';
import { onRequestPost as changePassword } from '../functions/api/account/password.js';
import { onRequestGet as pStaffList, onRequestPost as pStaffAdd } from '../functions/api/platform/tenants/[id]/staff.js';
import { onRequestPatch as pStaffPatch } from '../functions/api/platform/tenants/[id]/staff/[uid].js';
import { onRequestGet as platformAudit } from '../functions/api/platform/audit.js';

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

// ===== 7) إدارة المستشفيات من المنصة =====
const tenants = (await call(listTenants, { token: platform })).body.tenants;
const alnoorT = tenants.find((t) => t.slug === 'alnoor');
assert.equal(alnoorT.admin_email, 'admin@alnoor.com', 'قائمة المستشفيات تعرض بريد المدير');
const patchT = (token, id, body) => call(patchTenant, { method: 'PATCH', token, params: { id }, body });
assert.equal((await patchT(adminNoor, alnoorT.id, { status: 'suspended' })).status, 403, 'مدير مستشفى لا يوقف مستشفى');
assert.equal((await patchT(reception, alnoorT.id, { status: 'suspended' })).status, 403);
assert.equal((await patchT(platform, 'nope', { status: 'suspended' })).status, 404);
assert.equal((await patchT(platform, alnoorT.id, { status: 'deleted' })).status, 400);
assert.equal((await patchT(platform, alnoorT.id, {})).status, 400, 'طلب بلا تعديل');

// إيقاف المستشفى يقطع الجميع ويمنع الدخول، وإعادة التفعيل تعيدهم
assert.equal((await patchT(platform, alnoorT.id, { status: 'suspended' })).status, 200);
assert.equal((await call(listPatients, { token: reception })).status, 403, 'موظفو مستشفى موقوف ممنوعون فورًا');
assert.equal((await loginReq('alnoor', 'hala@alnoor.com', 'Brand-new-pass-1', '10.0.0.1')).status, 401, 'لا دخول لمستشفى موقوف');
assert.equal((await patchT(platform, alnoorT.id, { status: 'active' })).status, 200);
assert.equal((await call(listPatients, { token: reception })).status, 200);

// إعادة تعيين كلمة مرور مدير المستشفى (حتى لو كان محظورًا بسبب محاولات فاشلة)
for (let i = 0; i < 5; i++) await loginReq('alnoor', 'admin@alnoor.com', 'forgot-' + i, '10.0.0.2');
assert.equal((await loginReq('alnoor', 'admin@alnoor.com', 'Hospital-8842', '10.0.0.3')).status, 429, 'المدير محظور مؤقتًا');
assert.equal((await patchT(platform, alnoorT.id, { admin_password: 'weak' })).status, 400, 'سياسة كلمة المرور تنطبق');
assert.equal((await patchT(platform, alnoorT.id, { admin_password: 'Reset-by-owner-3', admin_email: 'nobody@x.com' })).status, 404);
r = await patchT(platform, alnoorT.id, { admin_password: 'Reset-by-owner-3' });
assert.equal(r.status, 200); assert.equal(r.body.admin_email, 'admin@alnoor.com');
assert.equal((await call(listPatients, { token: adminNoor })).status, 401, 'جلسة المدير القديمة سقطت');
assert.equal((await loginReq('alnoor', 'admin@alnoor.com', 'Hospital-8842', '10.0.0.4')).status, 401, 'الكلمة القديمة لا تعمل');
const adminNoor2 = (await loginReq('alnoor', 'admin@alnoor.com', 'Reset-by-owner-3', '10.0.0.4'));
assert.equal(adminNoor2.status, 200, 'الكلمة الجديدة تعمل فورًا بلا انتظار انتهاء القفل');
assert.ok((await call(listAudit, { token: adminNoor2.body.token })).body.events.some((e) => e.action === 'tenant.update'), 'العملية مسجَّلة');

// ===== 8) تغيير المستخدم لكلمة مروره =====
const chg = (token, current, next, ip) => call(changePassword, { path: '/api/account/password', method: 'POST', token, body: { current, next }, ip });
const me = await tokenFor('omar@alnoor.com', '11.0.0.1');
assert.equal((await chg(me, 'wrong-current', 'Another-pass-5501')).status, 400, 'الحالية خاطئة');
assert.equal((await chg(me, 'Staff-pass-7731', 'Staff-pass-7731')).status, 400, 'الجديدة مطابقة للحالية');
assert.equal((await chg(me, 'Staff-pass-7731', '12345678')).status, 400, 'الجديدة ضعيفة');
assert.equal((await chg(me, 'Staff-pass-7731', 'omar-secret-2026')).status, 400, 'تحتوي بريده');
assert.equal((await call(changePassword, { path: '/api/account/password', method: 'POST', token: me, body: {} })).status, 400);
assert.equal((await call(changePassword, { path: '/api/account/password', method: 'POST', body: { current: 'a', next: 'b' } })).status, 401, 'بلا جلسة');
r = await chg(me, 'Staff-pass-7731', 'Another-pass-5501');
assert.equal(r.status, 200);
assert.equal((await call(listPatients, { token: me })).status, 401, 'الجلسة القديمة سقطت');
assert.equal((await call(listPatients, { token: r.body.token })).status, 200, 'الجلسة الجديدة تعمل');
assert.equal((await loginReq('alnoor', 'omar@alnoor.com', 'Staff-pass-7731', '11.0.0.2')).status, 401);
assert.equal((await loginReq('alnoor', 'omar@alnoor.com', 'Another-pass-5501', '11.0.0.2')).status, 200);
// تخمين كلمة المرور الحالية عبر هذه النقطة يُقفل أيضًا (جلسة مسروقة لا تكفي)
const stolen = r.body.token;
for (let i = 0; i < 5; i++) await chg(stolen, 'guess-' + i, 'Whatever-pass-1234');
assert.equal((await chg(stolen, 'Another-pass-5501', 'Whatever-pass-1234')).status, 429, 'قفل تخمين الكلمة الحالية');
// مدير المنصة يغيّر كلمته أيضًا
const p2 = await chg(platform, 'Zebra-5521-kx', 'Platform-new-pass-77', '12.0.0.1');
assert.equal(p2.status, 200);
assert.equal((await call(listTenants, { token: p2.body.token })).status, 200);
assert.equal((await loginReq('platform', 'root@x.com', 'Platform-new-pass-77', '12.0.0.2')).status, 200);

// ===== 9) لوحة تحكم مدير المنصة =====
const P = p2.body.token; // جلسة مدير المنصة الحالية
const stList = (token, id) => call(pStaffList, { token, params: { id } });
const stAdd = (token, id, body) => call(pStaffAdd, { method: 'POST', token, params: { id }, body });
const stPatch = (token, id, uid, body) => call(pStaffPatch, { method: 'PATCH', token, params: { id, uid }, body });

// إحصاءات تجميعية بلا بيانات مرضى
const t9 = (await call(listTenants, { token: P })).body;
const noorRow = t9.tenants.find((t) => t.slug === 'alnoor');
assert.ok(noorRow.staff_count >= 4 && noorRow.patients_count >= 3 && 'appointments_count' in noorRow && noorRow.last_activity, 'أعداد وآخر نشاط');
assert.ok(!JSON.stringify(t9).includes('ليلى') && !JSON.stringify(t9).includes('0911111111'), 'لا أسماء مرضى ولا هواتفهم في لوحة المنصة');

// غير مدير المنصة لا يصل لأي مسار منصة
for (const [name, token] of [['مدير مستشفى', adminNoor2.body.token], ['استقبال', reception], ['محاسب', r.body.token]]) {
  assert.equal((await stList(token, alnoorT.id)).status, 403, name + ': قائمة الموظفين');
  assert.equal((await stAdd(token, alnoorT.id, { name: 'x', email: 'x@y.com', password: 'Some-pass-4412', role: 'admin' })).status, 403, name + ': إضافة');
  assert.equal((await stPatch(token, alnoorT.id, recId, { active: false })).status, 403, name + ': تعديل');
  assert.equal((await call(platformAudit, { token })).status, 403, name + ': نشاط المنصة');
}

// قائمة موظفي مستشفى
let list = (await stList(P, alnoorT.id)).body.staff;
assert.ok(list.length >= 4 && list.every((u) => !('password_hash' in u)), 'بلا تجزئة كلمات المرور');
assert.ok(list.some((u) => u.email === 'admin@alnoor.com' && u.last_login), 'آخر دخول معروف');
assert.equal((await stList(P, 'nope')).status, 404);

// إضافة موظف من المنصة
assert.equal((await stAdd(P, alnoorT.id, { name: 'د. جديد', email: 'newdoc@alnoor.com', password: 'Fresh-pass-6620', role: 'doctor' })).status, 201);
assert.equal((await stAdd(P, alnoorT.id, { name: 'مكرر', email: 'NEWDOC@alnoor.com', password: 'Fresh-pass-6620', role: 'doctor' })).status, 409);
assert.equal((await stAdd(P, alnoorT.id, { name: 'ضعيف', email: 'w@alnoor.com', password: '12345678', role: 'doctor' })).status, 400);
assert.equal((await stAdd(P, alnoorT.id, { name: 'خطر', email: 'pa@alnoor.com', password: 'Fresh-pass-6620', role: 'platform_admin' })).status, 400, 'لا ينشئ مدير منصة عبر هذا المسار');
assert.equal((await loginReq('alnoor', 'newdoc@alnoor.com', 'Fresh-pass-6620', '13.0.0.1')).status, 200);

// تعديل حساب موظف: إيقاف، تفعيل، كلمة مرور، دور
const newDocId = (await stList(P, alnoorT.id)).body.staff.find((u) => u.email === 'newdoc@alnoor.com').id;
const nd = (await loginReq('alnoor', 'newdoc@alnoor.com', 'Fresh-pass-6620', '13.0.0.1')).body.token;
assert.equal((await call(listPatients, { token: nd })).status, 200);
assert.equal((await stPatch(P, alnoorT.id, newDocId, { active: false })).status, 200);
assert.equal((await call(listPatients, { token: nd })).status, 403, 'الإيقاف من المنصة يقطع الموظف فورًا');
assert.equal((await stPatch(P, alnoorT.id, newDocId, { active: true })).status, 200);
assert.equal((await stPatch(P, alnoorT.id, newDocId, { password: 'Reset-from-panel-8' })).status, 200);
assert.equal((await call(listPatients, { token: nd })).status, 401, 'إعادة التعيين تُسقط جلسته');
assert.equal((await loginReq('alnoor', 'newdoc@alnoor.com', 'Reset-from-panel-8', '13.0.0.1')).status, 200);
assert.equal((await stPatch(P, alnoorT.id, newDocId, { role: 'reception' })).status, 200);
assert.equal((await stPatch(P, alnoorT.id, newDocId, { role: 'king' })).status, 400);
assert.equal((await stPatch(P, alnoorT.id, newDocId, {})).status, 400, 'لا تعديل');
assert.equal((await stPatch(P, alnoorT.id, 'nope', { active: false })).status, 404);
assert.equal((await stPatch(P, tenantAmal, newDocId, { active: false })).status, 404, 'موظف مستشفى لا يُعدَّل عبر مسار مستشفى آخر');

// حماية آخر مدير فعّال
const amalAdminId = (await stList(P, tenantAmal)).body.staff.find((u) => u.role === 'admin').id;
assert.equal((await stPatch(P, tenantAmal, amalAdminId, { active: false })).status, 400, 'لا يوقف آخر مدير');
assert.equal((await stPatch(P, tenantAmal, amalAdminId, { role: 'doctor' })).status, 400, 'لا يخفّض آخر مدير');
assert.equal((await stAdd(P, tenantAmal, { name: 'مدير ثانٍ', email: 'admin2@alamal.com', password: 'Second-admin-77', role: 'admin' })).status, 201);
assert.equal((await stPatch(P, tenantAmal, amalAdminId, { active: false })).status, 200, 'بوجود مدير آخر يُسمح');

// فك القفل: لموظف بعينه ولكل المستشفى
for (let i = 0; i < 5; i++) await loginReq('alnoor', 'newdoc@alnoor.com', 'bad-' + i, '13.0.0.9');
assert.equal((await loginReq('alnoor', 'newdoc@alnoor.com', 'Reset-from-panel-8', '13.0.0.8')).status, 429);
assert.equal((await stPatch(P, alnoorT.id, newDocId, { unlock: true })).status, 200);
assert.equal((await loginReq('alnoor', 'newdoc@alnoor.com', 'Reset-from-panel-8', '13.0.0.8')).status, 200);
for (let i = 0; i < 5; i++) await loginReq('alnoor', 'reem@alnoor.com', 'bad-' + i, '13.0.0.7');
assert.equal((await loginReq('alnoor', 'reem@alnoor.com', 'Staff-pass-7731', '13.0.0.6')).status, 429);
assert.equal((await patchT(P, alnoorT.id, { unlock: true })).status, 200, 'فك قفل كل المستشفى');
assert.equal((await loginReq('alnoor', 'reem@alnoor.com', 'Staff-pass-7731', '13.0.0.6')).status, 200);

// تسمية المستشفى
assert.equal((await patchT(P, alnoorT.id, { name: 'ن' })).status, 400);
assert.equal((await patchT(P, alnoorT.id, { name: 'مستشفى النور التخصصي' })).status, 200);
assert.equal((await call(listTenants, { token: P })).body.tenants.find((t) => t.slug === 'alnoor').name, 'مستشفى النور التخصصي');

// نشاط المنصة: بلا معرّفات ولا تفاصيل مرضى، وفيه عنوان المحاولات الفاشلة
const ev = (await call(platformAudit, { token: P })).body.events;
assert.ok(ev.length > 10 && ev.every((e) => !('target' in e) && !('tenant_id' in e)), 'بلا target ولا tenant_id');
assert.ok(ev.some((e) => e.tenant_name === 'مستشفى النور التخصصي' && e.action === 'staff.update'), 'يربط الحدث باسم المستشفى');
assert.ok(ev.filter((e) => /^(patient|appointment)\./.test(e.action)).every((e) => e.detail === null), 'أحداث المرضى والمواعيد بلا تفاصيل');
assert.ok(ev.some((e) => e.action === 'login.fail' && e.ip), 'عنوان المحاولات الفاشلة ظاهر لمدير المنصة');

console.log('security (إدارة الحسابات + لوحة المنصة): كل الاختبارات نجحت');
