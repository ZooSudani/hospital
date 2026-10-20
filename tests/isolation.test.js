// اختبار شامل: يمرّ كل طلب عبر الـ middleware ثم الـ handler الحقيقي، على SQLite محلية.
import assert from 'node:assert/strict';
import { makeDb } from './d1-shim.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequestPost as setup } from '../functions/api/setup.js';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { onRequestGet as listTenants, onRequestPost as createTenant } from '../functions/api/platform/tenants.js';
import { onRequestGet as listPatients, onRequestPost as addPatient } from '../functions/api/patients/index.js';
import { onRequestGet as getPatient } from '../functions/api/patients/[id].js';
import { onRequestGet as listStaff, onRequestPost as addStaff } from '../functions/api/staff/index.js';
import { onRequestPatch as patchStaff } from '../functions/api/staff/[id].js';
import { onRequestGet as listAppts, onRequestPost as addAppt } from '../functions/api/appointments/index.js';
import { onRequestPatch as patchAppt } from '../functions/api/appointments/[id].js';

const env = { DB: makeDb(), JWT_SECRET: 'test-secret-'.padEnd(48, 'x'), SETUP_KEY: 'k' };
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
r = await call(setup, { path: '/api/setup', method: 'POST', body: { key: 'k', email: 'root@x.com', name: 'مدير المنصة', password: 'Zebra-5521-kx' } });
assert.equal(r.status, 201);
r = await call(setup, { path: '/api/setup', method: 'POST', body: { key: 'k', email: 'root2@x.com', name: 'مدير', password: 'Zebra-5521-kx' } });
assert.equal(r.status, 409, 'لا يمكن إنشاء مدير منصة ثانٍ');

const platform = (await call(login, { path: '/api/auth/login', method: 'POST', body: { slug: 'platform', email: 'root@x.com', password: 'Zebra-5521-kx' } })).body.token;

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

// ===== إدارة الموظفين (قبل إيقاف المستشفى في المجموعة 8 نعيد تفعيله) =====
raw.prepare(`UPDATE tenants SET status = 'active' WHERE slug = 'alnoor'`).run();

// 10) إضافة موظفين
const mk = (token, body) => call(addStaff, { path: '/api/staff', method: 'POST', token, body });
r = await mk(noor, { name: 'د. هالة', email: 'hala@alnoor.com', password: 'doctor1234', role: 'doctor' });
assert.equal(r.status, 201);
const doctorNoorId = r.body.id;
r = await mk(noor, { name: 'ريم', email: 'reem@alnoor.com', password: 'recept1234', role: 'reception' });
assert.equal(r.status, 201);
assert.equal((await mk(noor, { name: 'مكرر', email: 'HALA@alnoor.com', password: 'doctor1234', role: 'doctor' })).status, 409, 'بريد مكرر في نفس المستشفى');
assert.equal((await mk(amal, { name: 'د. هالة', email: 'hala@alnoor.com', password: 'doctor1234', role: 'doctor' })).status, 201, 'نفس البريد مسموح في مستشفى آخر');
assert.equal((await mk(noor, { name: 'x', email: 'bad', password: '123', role: 'god' })).status, 400);
assert.equal((await mk(noor, { name: 'مدير منصة', email: 'p@x.com', password: 'Str0ng-passw0rd', role: 'platform_admin' })).status, 400, 'لا يمكن إنشاء مدير منصة من مستشفى');

// 11) الصلاحيات: غير المدير لا يدير الموظفين
const doctorToken = (await call(login, { path: '/api/auth/login', method: 'POST', body: { slug: 'alnoor', email: 'hala@alnoor.com', password: 'doctor1234' } })).body.token;
assert.equal((await call(listStaff, { token: doctorToken })).status, 403);
assert.equal((await mk(doctorToken, { name: 'س', email: 's@x.com', password: 'password123', role: 'admin' })).status, 403, 'الطبيب لا يستطيع ترقية نفسه أو إضافة مديرين');
assert.equal((await call(addPatient, { method: 'POST', token: doctorToken, body: { full_name: 'مريض الطبيب' } })).status, 403, 'الطبيب لا يسجل المرضى (قراءة فقط)');
assert.equal((await call(listPatients, { token: doctorToken })).status, 200, 'لكنه يقرأ قائمة المرضى');

// 12) عزل الموظفين بين المستشفيات
assert.equal((await call(listStaff, { token: noor })).body.staff.length, 3);
assert.equal((await call(listStaff, { token: amal })).body.staff.length, 2);
r = await call(patchStaff, { method: 'PATCH', token: amal, params: { id: doctorNoorId }, body: { active: false } });
assert.equal(r.status, 404, 'مدير الأمل لا يعدّل موظف النور');
assert.equal((await call(listPatients, { token: doctorToken })).status, 200, 'طبيب النور ما زال فعّالًا');

// 13) تعطيل الموظف يقطع وصوله فورًا، وإعادة تفعيله تعيده
r = await call(patchStaff, { method: 'PATCH', token: noor, params: { id: doctorNoorId }, body: { active: false } });
assert.equal(r.status, 200);
assert.equal((await call(listPatients, { token: doctorToken })).status, 403, 'التوكن القديم يتوقف فورًا');
assert.equal((await call(login, { path: '/api/auth/login', method: 'POST', body: { slug: 'alnoor', email: 'hala@alnoor.com', password: 'doctor1234' } })).status, 401, 'لا دخول جديد للموقوف');
await call(patchStaff, { method: 'PATCH', token: noor, params: { id: doctorNoorId }, body: { active: true } });
assert.equal((await call(listPatients, { token: doctorToken })).status, 200);

// 14) تغيير الدور يسري فورًا (طبيب إلى محاسب: يقرأ ولا يكتب)
await call(patchStaff, { method: 'PATCH', token: noor, params: { id: doctorNoorId }, body: { role: 'reception' } });
assert.equal((await call(addPatient, { method: 'POST', token: doctorToken, body: { full_name: 'مريض آخر' } })).status, 201, 'بعد الترقية للاستقبال يكتب فورًا بنفس التوكن');
await call(patchStaff, { method: 'PATCH', token: noor, params: { id: doctorNoorId }, body: { role: 'accountant' } });
assert.equal((await call(addPatient, { method: 'POST', token: doctorToken, body: { full_name: 'مريض ثالث' } })).status, 403, 'بعد التخفيض للمحاسب يُمنع فورًا');
assert.equal((await call(listPatients, { token: doctorToken })).status, 200);

// 15) إعادة تعيين كلمة المرور
await call(patchStaff, { method: 'PATCH', token: noor, params: { id: doctorNoorId }, body: { password: 'newpass9999' } });
assert.equal((await call(login, { path: '/api/auth/login', method: 'POST', body: { slug: 'alnoor', email: 'hala@alnoor.com', password: 'doctor1234' } })).status, 401);
assert.equal((await call(login, { path: '/api/auth/login', method: 'POST', body: { slug: 'alnoor', email: 'hala@alnoor.com', password: 'newpass9999' } })).status, 200);
assert.equal((await call(listPatients, { token: doctorToken })).status, 401, 'التوكن القديم يسقط فور تغيير كلمة المرور');

// 16) المدير لا يوقف نفسه ولا يغيّر دوره
const adminNoorId = (await call(listStaff, { token: noor })).body.staff.find((u) => u.email === 'admin@alnoor.com').id;
assert.equal((await call(patchStaff, { method: 'PATCH', token: noor, params: { id: adminNoorId }, body: { active: false } })).status, 400);
assert.equal((await call(patchStaff, { method: 'PATCH', token: noor, params: { id: adminNoorId }, body: { role: 'doctor' } })).status, 400);

console.log('staff: كل الاختبارات نجحت (7 مجموعات)');

// ===== المواعيد =====
const loginAs = async (slug, email, password) =>
  (await call(login, { path: '/api/auth/login', method: 'POST', body: { slug, email, password } })).body.token;

// طبيبان جديدان في النور، وطبيب في الأمل
const dr1 = (await mk(noor, { name: 'د. مازن', email: 'mazin@alnoor.com', password: 'doctor1234', role: 'doctor' })).body.id;
const dr2 = (await mk(noor, { name: 'د. سلمى', email: 'salma@alnoor.com', password: 'doctor1234', role: 'doctor' })).body.id;
const drAmal = (await mk(amal, { name: 'د. أمل', email: 'dr@alamal.com', password: 'doctor1234', role: 'doctor' })).body.id;
const reception = await loginAs('alnoor', 'reem@alnoor.com', 'recept1234');
const doc1Token = await loginAs('alnoor', 'mazin@alnoor.com', 'doctor1234');
const doc2Token = await loginAs('alnoor', 'salma@alnoor.com', 'doctor1234');
const book = (token, b) => call(addAppt, { path: '/api/appointments', method: 'POST', token, body: b });
const day = '2026-11-02';

// 17) حجز ناجح، ثم منع الحجز المزدوج على مستوى القاعدة
r = await book(reception, { patient_id: p1.id, doctor_id: dr1, starts_at: `${day}T10:00` });
assert.equal(r.status, 201, JSON.stringify(r.body));
const apptId = r.body.id;
assert.equal((await book(reception, { patient_id: p2.id, doctor_id: dr1, starts_at: `${day} 10:00` })).status, 409, 'نفس الطبيب ونفس الوقت');
assert.equal((await book(reception, { patient_id: p2.id, doctor_id: dr2, starts_at: `${day} 10:00` })).status, 201, 'طبيب آخر في نفس الوقت مسموح');
assert.equal((await book(reception, { patient_id: p2.id, doctor_id: dr1, starts_at: `${day} 10:15` })).status, 201, 'وقت آخر لنفس الطبيب مسموح');

// 18) التحقق من المدخلات
assert.equal((await book(reception, { patient_id: p1.id, doctor_id: dr1, starts_at: `${day} 10:07` })).status, 400, 'دقائق غير مسموحة');
assert.equal((await book(reception, { patient_id: p1.id, doctor_id: dr1, starts_at: 'غد' })).status, 400);
assert.equal((await book(reception, { patient_id: p1.id, doctor_id: dr1, starts_at: '2026-02-31 10:00' })).status, 400, 'تاريخ غير موجود');
assert.equal((await book(reception, { patient_id: 'nope', doctor_id: dr1, starts_at: `${day} 11:00` })).status, 400);
assert.equal((await book(reception, { patient_id: p1.id, doctor_id: adminNoorId, starts_at: `${day} 11:00` })).status, 400, 'الموعد لا يُحجز عند غير الأطباء');

// 19) العزل: لا مريض ولا طبيب من مستشفى آخر
assert.equal((await book(reception, { patient_id: p3.id, doctor_id: dr1, starts_at: `${day} 12:00` })).status, 400, 'مريض الأمل');
assert.equal((await book(reception, { patient_id: p1.id, doctor_id: drAmal, starts_at: `${day} 12:00` })).status, 400, 'طبيب الأمل');
assert.equal((await call(listAppts, { path: `/api/appointments?date=${day}`, token: amal })).body.appointments.length, 0);
assert.equal((await call(patchAppt, { method: 'PATCH', token: amal, params: { id: apptId }, body: { status: 'cancelled' } })).status, 404, 'مدير الأمل لا يلغي موعد النور');

// 20) الصلاحيات: الطبيب لا يحجز، ويرى مواعيده فقط، والمحاسب لا يرى المواعيد
assert.equal((await book(doc1Token, { patient_id: p1.id, doctor_id: dr1, starts_at: `${day} 13:00` })).status, 403);
const listFor = async (token) => (await call(listAppts, { path: `/api/appointments?date=${day}`, token })).body.appointments;
assert.equal((await listFor(reception)).length, 3);
assert.equal((await listFor(doc1Token)).length, 2);
assert.equal((await listFor(doc2Token)).length, 1);
assert.ok((await listFor(doc2Token)).every((a) => a.doctor_id === dr2));
const accountantToken = await loginAs('alnoor', 'hala@alnoor.com', 'newpass9999');
assert.equal((await call(listAppts, { path: `/api/appointments?date=${day}`, token: accountantToken })).status, 403, 'المحاسب ممنوع');
assert.equal((await call(listAppts, { path: '/api/appointments?date=bad', token: reception })).status, 400);

// 21) تغيير الحالة: الطبيب لموعده فقط ولا يلغي، والإلغاء يحرر الوقت
const doc2Appt = (await listFor(doc2Token))[0].id;
assert.equal((await call(patchAppt, { method: 'PATCH', token: doc1Token, params: { id: doc2Appt }, body: { status: 'done' } })).status, 403, 'طبيب لا يعدّل موعد زميله');
assert.equal((await call(patchAppt, { method: 'PATCH', token: doc1Token, params: { id: apptId }, body: { status: 'cancelled' } })).status, 403, 'الطبيب لا يلغي');
assert.equal((await call(patchAppt, { method: 'PATCH', token: doc1Token, params: { id: apptId }, body: { status: 'done' } })).status, 200);
assert.equal((await call(patchAppt, { method: 'PATCH', token: reception, params: { id: apptId }, body: { status: 'cancelled' } })).status, 409, 'موعد منتهٍ');
assert.equal((await call(patchAppt, { method: 'PATCH', token: reception, params: { id: doc2Appt }, body: { status: 'cancelled' } })).status, 200);
assert.equal((await book(reception, { patient_id: p1.id, doctor_id: dr2, starts_at: `${day} 10:00` })).status, 201, 'الوقت المُلغى يعود متاحًا');
assert.equal((await book(reception, { patient_id: p2.id, doctor_id: dr1, starts_at: `${day} 10:00` })).status, 201, 'وقت موعد "تم" يعود متاحًا أيضًا');

// 22) الحارس المركزي في الإنتاج: استعلام بلا tenant_id يُرفض قبل التنفيذ
import { guardedExecutor, IsolationError } from '../lib/isolation/executors.js';
const guarded = guardedExecutor(env.DB, tenantIds.alnoor);
await assert.rejects(() => guarded({ kind: 'all', sql: 'SELECT id, tenant_id FROM patients', args: [] }), (e) => e instanceof IsolationError && e.code === 'missing-tenant-filter');
await assert.rejects(() => guarded({ kind: 'all', sql: 'SELECT id, tenant_id FROM patients WHERE tenant_id = ? OR 1=1', args: [tenantIds.alamal] }), (e) => e.code === 'cross-tenant-row');

console.log('appointments: كل الاختبارات نجحت (6 مجموعات)');
