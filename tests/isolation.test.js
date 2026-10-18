// اختبار شامل: يمرّ كل طلب عبر الـ middleware ثم الـ handler الحقيقي، على SQLite محلية.
import assert from 'node:assert/strict';
import { makeDb } from './d1-shim.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequestPost as setup } from '../functions/api/setup.js';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { onRequestGet as listTenants, onRequestPost as createTenant } from '../functions/api/platform/tenants.js';
import { onRequestGet as listPatients, onRequestPost as addPatient } from '../functions/api/patients/index.js';
import { onRequestGet as getPatient } from '../functions/api/patients/[id].js';

const env = { DB: makeDb(), JWT_SECRET: 'test-secret', SETUP_KEY: 'k' };
const call = async (handler, { path = '/api/x', method = 'GET', body, token, params = {} } = {}) => {
  const request = new Request(`https://x.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = {};
  let res = await middleware({ request, env, data, next: async () => handler({ request, env, data, params }) });
  return { status: res.status, body: await res.json() };
};

// 1) إعداد المنصة
let r = await call(setup, { path: '/api/setup', method: 'POST', body: { key: 'bad', email: 'a@b.c', name: 'مدير', password: '12345678' } });
assert.equal(r.status, 403);
r = await call(setup, { path: '/api/setup', method: 'POST', body: { key: 'k', email: 'root@x.com', name: 'مدير المنصة', password: 'rootpass123' } });
assert.equal(r.status, 201);
r = await call(setup, { path: '/api/setup', method: 'POST', body: { key: 'k', email: 'root2@x.com', name: 'مدير', password: 'rootpass123' } });
assert.equal(r.status, 409, 'لا يمكن إنشاء مدير منصة ثانٍ');

const platform = (await call(login, { path: '/api/auth/login', method: 'POST', body: { slug: 'platform', email: 'root@x.com', password: 'rootpass123' } })).body.token;

// 2) إنشاء مستشفيين
for (const [slug, name] of [['alnoor', 'مستشفى النور'], ['alamal', 'مستشفى الأمل']]) {
  r = await call(createTenant, { path: '/api/platform/tenants', method: 'POST', token: platform,
    body: { name, slug, admin_email: `admin@${slug}.com`, admin_name: `مدير ${name}`, admin_password: 'hospital123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
}
r = await call(createTenant, { path: '/api/platform/tenants', method: 'POST', token: platform,
  body: { name: 'مكرر', slug: 'alnoor', admin_email: 'z@z.com', admin_name: 'مدير', admin_password: 'hospital123' } });
assert.equal(r.status, 409);

const tokenOf = async (slug) =>
  (await call(login, { path: '/api/auth/login', method: 'POST', body: { slug, email: `admin@${slug}.com`, password: 'hospital123' } })).body.token;
const noor = await tokenOf('alnoor');
const amal = await tokenOf('alamal');

// 3) مدير المستشفى لا يصل لواجهات المنصة، ومدير المنصة لا يصل لبيانات المرضى
assert.equal((await call(listTenants, { token: noor })).status, 403);
assert.equal((await call(listPatients, { token: platform })).status, 403);

// 4) مرضى كل مستشفى
const p1 = (await call(addPatient, { method: 'POST', token: noor, body: { full_name: 'أحمد محمد علي', phone: '0912345678' } })).body;
const p2 = (await call(addPatient, { method: 'POST', token: noor, body: { full_name: 'سارة عثمان' } })).body;
const p3 = (await call(addPatient, { method: 'POST', token: amal, body: { full_name: 'خالد إبراهيم' } })).body;
assert.equal(p1.file_no, '1'); assert.equal(p2.file_no, '2'); assert.equal(p3.file_no, '1', 'ترقيم الملفات مستقل لكل مستشفى');

const listNoor = (await call(listPatients, { token: noor })).body.patients;
const listAmal = (await call(listPatients, { token: amal })).body.patients;
assert.equal(listNoor.length, 2); assert.equal(listAmal.length, 1);
assert.ok(!listNoor.some((p) => p.full_name === 'خالد إبراهيم'));
assert.equal((await call(listPatients, { path: '/api/patients?q=سارة', token: noor })).body.patients.length, 1);

// 5) محاولة وصول عابر: مستشفى الأمل يطلب مريضًا من النور
r = await call(getPatient, { token: amal, params: { id: p1.id } });
assert.equal(r.status, 404, 'يجب ألا يرى مستشفى الأمل مريض النور');
assert.equal((await call(getPatient, { token: noor, params: { id: p1.id } })).status, 200);

// 6) IDOR: إرسال tenant_id في جسم الطلب يجب أن يُتجاهل
r = await call(addPatient, { method: 'POST', token: amal, body: { full_name: 'محاولة اختراق', tenant_id: 'any', tid: 'any' } });
assert.equal(r.status, 201);
assert.ok(!(await call(listPatients, { token: noor })).body.patients.some((p) => p.full_name === 'محاولة اختراق'));

// 7) المفتاح الأجنبي المركب يمنع ربط سجل بمريض مستشفى آخر على مستوى القاعدة
const raw = env.DB.raw;
raw.exec('PRAGMA foreign_keys = ON');
const tenantIds = Object.fromEntries(raw.prepare('SELECT slug, id FROM tenants').all().map((t) => [t.slug, t.id]));
const doctorAmal = raw.prepare('SELECT id FROM users WHERE tenant_id = ?').get(tenantIds.alamal).id;
assert.throws(
  () => raw.prepare(`INSERT INTO appointments (id, tenant_id, patient_id, doctor_id, starts_at) VALUES ('a1', ?, ?, ?, '2026-11-01 10:00')`)
          .run(tenantIds.alamal, p1.id, doctorAmal),
  /FOREIGN KEY/, 'قاعدة البيانات يجب أن ترفض موعدًا يربط الأمل بمريض النور');

// 8) إيقاف مستشفى يقطع الوصول فورًا رغم صلاحية التوكن
raw.prepare(`UPDATE tenants SET status = 'suspended' WHERE slug = 'alnoor'`).run();
assert.equal((await call(listPatients, { token: noor })).status, 403);
assert.equal((await call(listPatients, { token: amal })).status, 200);

// 9) دخول بكلمة مرور خاطئة أو مستشفى غير موجود
assert.equal((await call(login, { path: '/api/auth/login', method: 'POST', body: { slug: 'alamal', email: 'admin@alamal.com', password: 'wrong' } })).status, 401);
assert.equal((await call(login, { path: '/api/auth/login', method: 'POST', body: { slug: 'nope', email: 'a@b.c', password: 'x' } })).status, 401);
assert.equal((await call(listPatients, { token: 'garbage' })).status, 401);

console.log('isolation: كل الاختبارات نجحت (9 مجموعات)');
