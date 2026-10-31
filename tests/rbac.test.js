// اختبار نظام الصلاحيات: مصفوفة كاملة (كل دور × كل عملية)، والتخصيص لكل شخص، والسجل الطبي، والفواتير.
import assert from 'node:assert/strict';
import { makeDb } from './d1-shim.js';
import { ROLE_DEFAULTS, CATALOG, effectivePermissions, normalizeOverrides } from '../lib/permissions.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequestPost as setup } from '../functions/api/setup.js';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { onRequestPost as createTenant } from '../functions/api/platform/tenants.js';
import { onRequestGet as me } from '../functions/api/me.js';
import { onRequestGet as listPatients, onRequestPost as addPatient } from '../functions/api/patients/index.js';
import { onRequestGet as getPatient, onRequestPatch as patchPatient } from '../functions/api/patients/[id].js';
import { onRequestGet as listVisits, onRequestPost as addVisit } from '../functions/api/patients/[id]/visits.js';
import { onRequestGet as listAppts, onRequestPost as addAppt } from '../functions/api/appointments/index.js';
import { onRequestPatch as patchAppt } from '../functions/api/appointments/[id].js';
import { onRequestGet as listInvoices, onRequestPost as addInvoice } from '../functions/api/invoices/index.js';
import { onRequestPatch as patchInvoice } from '../functions/api/invoices/[id].js';
import { onRequestPost as payInvoice } from '../functions/api/invoices/[id]/pay.js';
import { onRequestGet as listPayments } from '../functions/api/invoices/[id]/payments.js';
import { onRequestGet as reportSummary } from '../functions/api/reports/summary.js';
import { onRequestGet as listStaff, onRequestPost as addStaff } from '../functions/api/staff/index.js';
import { onRequestPatch as patchStaff } from '../functions/api/staff/[id].js';
import { onRequestGet as getPerms, onRequestPut as putPerms } from '../functions/api/staff/[id]/permissions.js';
import { onRequestGet as listAudit } from '../functions/api/audit.js';
import { onRequestGet as pGetPerms, onRequestPut as pPutPerms } from '../functions/api/platform/tenants/[id]/staff/[uid]/permissions.js';
import { onRequestGet as pStaffList } from '../functions/api/platform/tenants/[id]/staff.js';

// ===== 0) سلامة مصفوفة الأدوار نفسها =====
const KEYS = new Set(CATALOG.map((p) => p.key));
for (const [role, perms] of Object.entries(ROLE_DEFAULTS)) {
  assert.ok(perms.every((k) => KEYS.has(k)), `${role}: صلاحيات غير معرّفة في الكتالوج`);
  assert.equal(new Set(perms).size, perms.length, `${role}: تكرار`);
}
assert.ok(!ROLE_DEFAULTS.admin.includes('visits.read') && !ROLE_DEFAULTS.admin.includes('invoices.collect'), 'فصل المهام: المدير لا يقرأ السجل الطبي ولا يحصّل المال');
assert.ok(!ROLE_DEFAULTS.reception.includes('visits.read'), 'الاستقبال لا يقرأ السجل الطبي');
assert.ok(ROLE_DEFAULTS.doctor.includes('visits.write') && !ROLE_DEFAULTS.doctor.includes('patients.create'), 'الطبيب يكتب السجل ولا يسجل المرضى');
assert.ok(!ROLE_DEFAULTS.accountant.includes('visits.read'), 'المحاسب لا يقرأ السجل الطبي');
assert.deepEqual(effectivePermissions('reception', { grant: ['visits.read'], deny: ['visits.read', 'patients.create'] }).includes('visits.read'), false, 'السحب يغلب المنح');
assert.equal(normalizeOverrides({ grant: ['patients.read'], deny: [] }, 'doctor', { callerIsPlatform: false }).value.grant.length, 0, 'منح ما يملكه الدور يُختصر');

// ===== تجهيز بيئة: مستشفيان، وموظف لكل دور =====
const env = { DB: makeDb(), JWT_SECRET: 'rbac-test-secret-'.padEnd(48, 'x'), SETUP_KEY: 'k' };
const raw = env.DB.raw;
let n = 0;
const call = async (handler, { path = '/api/x', method = 'GET', body, token, params = {} } = {}) => {
  const request = new Request(`https://x.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.9.${Math.floor(++n / 250)}.${n % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = {};
  const res = await middleware({ request, env, data, next: async () => handler({ request, env, data, params }) });
  return { status: res.status, body: await res.json() };
};
const post = (h, path, body, o = {}) => call(h, { path, method: 'POST', body, ...o });
const loginAs = async (slug, email, pw) => (await post(login, '/api/auth/login', { slug, email, password: pw })).body;

await post(setup, '/api/setup', { key: 'k', email: 'root@x.com', name: 'مدير المنصة', password: 'Zebra-5521-kx' });
const platform = (await loginAs('platform', 'root@x.com', 'Zebra-5521-kx')).token;
for (const slug of ['alnoor', 'alamal']) {
  await post(createTenant, '/api/platform/tenants', { name: slug, slug, admin_email: `admin@${slug}.com`, admin_name: 'مدير ' + slug, admin_password: 'Hospital-8842' }, { token: platform });
}
const tid = Object.fromEntries(raw.prepare('SELECT slug, id FROM tenants').all().map((t) => [t.slug, t.id]));
const adminNoor = (await loginAs('alnoor', 'admin@alnoor.com', 'Hospital-8842')).token;
const adminAmal = (await loginAs('alamal', 'admin@alamal.com', 'Hospital-8842')).token;
const mk = async (token, name, email, role) => (await post(addStaff, '/api/staff', { name, email, password: 'Staff-pass-7731', role }, { token })).body.id;
const ids = { doctor: await mk(adminNoor, 'د. هالة', 'hala@alnoor.com', 'doctor'), doctor2: await mk(adminNoor, 'د. سلمى', 'salma@alnoor.com', 'doctor'), reception: await mk(adminNoor, 'ريم', 'reem@alnoor.com', 'reception'), accountant: await mk(adminNoor, 'عمر', 'omar@alnoor.com', 'accountant') };
const tk = async (email) => (await loginAs('alnoor', email, 'Staff-pass-7731')).token;
const T = { admin: adminNoor, doctor: await tk('hala@alnoor.com'), doctor2: await tk('salma@alnoor.com'), reception: await tk('reem@alnoor.com'), accountant: await tk('omar@alnoor.com') };
const adminId = raw.prepare(`SELECT id FROM users WHERE email = 'admin@alnoor.com'`).get().id;

// مريضان ومعهما موعد لكل طبيب
const p1 = (await post(addPatient, '/api/patients', { full_name: 'أحمد محمد علي', phone: '0911111111' }, { token: T.reception })).body.id;
const p2 = (await post(addPatient, '/api/patients', { full_name: 'سارة عثمان' }, { token: T.reception })).body.id;
const pAmal = (await post(addPatient, '/api/patients', { full_name: 'مريض الأمل' }, { token: adminAmal })).body.id;
const day = '2026-12-01';
const a1 = (await post(addAppt, '/api/appointments', { patient_id: p1, doctor_id: ids.doctor, starts_at: `${day} 09:00` }, { token: T.reception })).body.id;
const a2 = (await post(addAppt, '/api/appointments', { patient_id: p2, doctor_id: ids.doctor2, starts_at: `${day} 09:00` }, { token: T.reception })).body.id;

// ===== 1) المصفوفة: كل عملية مع الأدوار المسموح لها بالضبط =====
// كل عملية تُجرَّب بكل دور؛ المسموح لا يعطي 403، وغير المسموح يعطي 403 (وليس 401 ولا 500).
const ops = [
  ['patients.read: قائمة المرضى', 'patients.read', (t) => call(listPatients, { token: t })],
  ['patients.read: ملف مريض', 'patients.read', (t) => call(getPatient, { token: t, params: { id: p1 } })],
  ['patients.create', 'patients.create', (t) => post(addPatient, '/api/patients', { full_name: 'مريض جديد ' + Math.random() }, { token: t })],
  ['patients.update', 'patients.update', (t) => call(patchPatient, { method: 'PATCH', token: t, params: { id: p2 }, body: { phone: '0900000000' } })],
  ['appointments.read', 'appointments.read', (t) => call(listAppts, { path: `/api/appointments?date=${day}`, token: t })],
  ['appointments.book', 'appointments.book', (t) => post(addAppt, '/api/appointments', { patient_id: p1, doctor_id: ids.doctor, starts_at: `${day} ${String(10 + (n % 10)).padStart(2, '0')}:${['00', '15', '30', '45'][n % 4]}` }, { token: t })],
  ['staff.manage: قائمة الموظفين', 'staff.manage', (t) => call(listStaff, { token: t })],
  ['staff.manage: إضافة موظف', 'staff.manage', (t) => post(addStaff, '/api/staff', { name: 'موظف ' + n, email: `u${n}@alnoor.com`, password: 'Staff-pass-7731', role: 'accountant' }, { token: t })],
  ['audit.view', 'audit.view', (t) => call(listAudit, { token: t })],
  ['visits.read', 'visits.read', (t) => call(listVisits, { token: t, params: { id: p1 } })],
  ['visits.write', 'visits.write', (t) => post(addVisit, '/api/x', { diagnosis: 'حمى' }, { token: t, params: { id: p1 } })],
  ['invoices.read', 'invoices.read', (t) => call(listInvoices, { token: t })],
  ['invoices.create', 'invoices.create', (t) => post(addInvoice, '/api/invoices', { patient_id: p1, total: 5000 }, { token: t })],
];
const roles = ['admin', 'doctor', 'reception', 'accountant'];
const invSeed = (await post(addInvoice, '/api/invoices', { patient_id: p1, total: 900 }, { token: T.accountant })).body.id;
ops.push(['reports.view', 'reports.view', (t) => call(reportSummary, { token: t })]);
ops.push(['invoices.read: دفعات فاتورة', 'invoices.read', (t) => call(listPayments, { token: t, params: { id: invSeed } })]);
let checks = 0;
for (const [name, perm, run] of ops) {
  for (const role of roles) {
    const r = await run(T[role]);
    const allowed = ROLE_DEFAULTS[role].includes(perm);
    if (allowed) assert.notEqual(r.status, 403, `${name}: ${role} يجب أن يُسمح له (${r.status} ${JSON.stringify(r.body)})`);
    else assert.equal(r.status, 403, `${name}: ${role} يجب أن يُمنع (${r.status})`);
    assert.ok(r.status !== 401 && r.status < 500, `${name}/${role}: ${r.status}`);
    checks++;
  }
  assert.equal((await run(undefined)).status, 401, `${name}: بلا جلسة`);
}
console.log(`  المصفوفة: ${checks} فحصًا (${ops.length} عملية × ${roles.length} أدوار)`);

// عمليات تحتاج حالة خاصة
const inv = (await call(listInvoices, { token: T.accountant })).body.invoices[0].id;
for (const role of roles) {
  const collect = await post(payInvoice, '/api/x', { amount: 1, method: 'cash' }, { token: T[role], params: { id: inv } });
  assert.equal(collect.status === 403, !ROLE_DEFAULTS[role].includes('invoices.collect'), 'تحصيل: ' + role);
}
const inv2 = (await post(addInvoice, '/api/invoices', { patient_id: p1, total: 700 }, { token: T.accountant })).body.id;
for (const role of ['admin', 'doctor', 'reception']) {
  assert.equal((await call(patchInvoice, { method: 'PATCH', token: T[role], params: { id: inv2 }, body: { status: 'void' } })).status, 403, 'إلغاء فاتورة: ' + role);
}
assert.equal((await call(patchInvoice, { method: 'PATCH', token: T.accountant, params: { id: inv2 }, body: { status: 'void' } })).status, 200);

// ===== 2) /api/me =====
for (const role of roles) {
  const r = await call(me, { token: T[role] });
  assert.deepEqual([...r.body.permissions].sort(), [...ROLE_DEFAULTS[role]].sort(), 'me: ' + role);
}
assert.deepEqual((await call(me, { token: platform })).body.permissions, [], 'مدير المنصة بلا صلاحيات مستشفيات');
assert.equal((await call(me, { token: platform })).body.tenant, null);
assert.deepEqual((await loginAs('alnoor', 'hala@alnoor.com', 'Staff-pass-7731')).permissions.sort(), [...ROLE_DEFAULTS.doctor].sort(), 'الدخول يُرجع الصلاحيات');
assert.equal((await call(me, {})).status, 401);

// ===== 3) السجل الطبي: الطبيب فقط، ومؤرشف، ولا يُعدَّل =====
assert.equal((await post(addVisit, '/api/x', { diagnosis: '' }, { token: T.doctor, params: { id: p1 } })).status, 400, 'زيارة فارغة');
assert.equal((await post(addVisit, '/api/x', { diagnosis: 'ن'.repeat(3000) }, { token: T.doctor, params: { id: p1 } })).status, 201, 'يُقتطع الطول ولا ينهار');
assert.equal((await post(addVisit, '/api/x', { diagnosis: 'x' }, { token: T.doctor, params: { id: 'nope' } })).status, 404);
assert.equal((await post(addVisit, '/api/x', { diagnosis: 'x' }, { token: T.doctor, params: { id: pAmal } })).status, 404, 'مريض مستشفى آخر');
assert.equal((await post(addVisit, '/api/x', { diagnosis: 'x', appointment_id: a2 }, { token: T.doctor, params: { id: p1 } })).status, 400, 'موعد لمريض آخر');
let r = await post(addVisit, '/api/x', { diagnosis: 'التهاب حلق', notes: 'راحة وسوائل', prescription: 'أموكسيسيلين 500', appointment_id: a1, doctor_id: 'someone-else' }, { token: T.doctor, params: { id: p1 } });
assert.equal(r.status, 201);
let v = (await call(listVisits, { token: T.doctor, params: { id: p1 } })).body;
assert.equal(v.visits[0].diagnosis, 'التهاب حلق');
assert.equal(v.visits[0].doctor_name, 'د. هالة', 'الكاتب هو المستخدم الحالي لا ما يرسله الطلب');
assert.ok(v.visits.every((x) => !('tenant_id' in x)));
assert.equal((await call(listVisits, { token: T.doctor2, params: { id: p1 } })).body.visits.length, 3, 'الأطباء يقرؤون سجل المريض كله (ثلاث زيارات: واحدة من المصفوفة واثنتان هنا)');
const ev = (await call(listAudit, { token: T.admin })).body.events;
assert.ok(ev.some((e) => e.action === 'visit.create') && ev.some((e) => e.action === 'visit.view'), 'كتابة السجل الطبي وقراءته مسجَّلتان');
assert.ok(!JSON.stringify(ev).includes('التهاب') && !JSON.stringify(ev).includes('أموكسيسيلين'), 'محتوى السجل الطبي لا يدخل سجل النشاط');
assert.equal((await call(listVisits, { token: adminAmal, params: { id: p1 } })).status, 403, 'مدير مستشفى آخر لا يقرأ السجل');

// ===== 4) الفواتير: التحصيل ذري ومحمي =====
assert.equal((await post(addInvoice, '/api/invoices', { patient_id: p1, total: 0 }, { token: T.accountant })).status, 400);
assert.equal((await post(addInvoice, '/api/invoices', { patient_id: p1, total: -5 }, { token: T.accountant })).status, 400);
assert.equal((await post(addInvoice, '/api/invoices', { patient_id: p1, total: 12.5 }, { token: T.accountant })).status, 400, 'كسر');
assert.equal((await post(addInvoice, '/api/invoices', { patient_id: p1, total: 'abc' }, { token: T.accountant })).status, 400);
assert.equal((await post(addInvoice, '/api/invoices', { patient_id: p1, total: 1e12 }, { token: T.accountant })).status, 400, 'حد أعلى');
assert.equal((await post(addInvoice, '/api/invoices', { patient_id: pAmal, total: 100 }, { token: T.accountant })).status, 400, 'مريض مستشفى آخر');
const inv3 = (await post(addInvoice, '/api/invoices', { patient_id: p1, total: 1000 }, { token: T.accountant })).body.id;
const pay = (amount, id = inv3) => post(payInvoice, '/api/x', { amount, method: 'cash' }, { token: T.accountant, params: { id } });
assert.equal((await pay(0)).status, 400);
assert.equal((await pay(-100)).status, 400);
assert.equal((await pay(1500)).status, 409, 'لا يتجاوز قيمة الفاتورة');
assert.equal((await pay(400)).status, 200);
assert.equal((await pay(700)).status, 409, 'يتجاوز المتبقي (600)');
assert.equal((await call(patchInvoice, { method: 'PATCH', token: T.accountant, params: { id: inv3 }, body: { status: 'void' } })).status, 409, 'لا تُلغى فاتورة عليها دفعة');
assert.equal((await pay(600)).status, 200);
let row = (await call(listInvoices, { token: T.accountant })).body.invoices.find((i) => i.id === inv3);
assert.equal(row.paid, 1000); assert.equal(row.status, 'paid', 'تُغلق عند اكتمال السداد');
assert.equal((await pay(1)).status, 409, 'لا دفع على فاتورة مغلقة');
const voided = (await call(listInvoices, { token: T.accountant })).body.invoices.find((i) => i.id === inv2);
assert.equal(voided.status, 'void');
assert.equal((await pay(5, inv2)).status, 409, 'لا دفع على فاتورة ملغاة');
assert.equal((await post(payInvoice, '/api/x', { amount: 5, method: 'cash' }, { token: adminAmal, params: { id: inv3 } })).status, 403);
const amalAccountant = await (async () => { await mk(adminAmal, 'محاسب الأمل', 'acc@alamal.com', 'accountant'); return (await loginAs('alamal', 'acc@alamal.com', 'Staff-pass-7731')).token; })();
assert.equal((await post(payInvoice, '/api/x', { amount: 5, method: 'cash' }, { token: amalAccountant, params: { id: inv3 } })).status, 404, 'محاسب مستشفى آخر لا يصل لفاتورتنا');
assert.equal((await call(listInvoices, { token: amalAccountant })).body.invoices.length, 0, 'عزل الفواتير');

// ===== 5) تعديل المريض =====
assert.equal((await call(patchPatient, { method: 'PATCH', token: T.reception, params: { id: p2 }, body: { full_name: 'x' } })).status, 400);
assert.equal((await call(patchPatient, { method: 'PATCH', token: T.reception, params: { id: p2 }, body: {} })).status, 400);
assert.equal((await call(patchPatient, { method: 'PATCH', token: T.reception, params: { id: p2 }, body: { gender: 'x' } })).status, 400);
assert.equal((await call(patchPatient, { method: 'PATCH', token: T.reception, params: { id: pAmal }, body: { phone: '1' } })).status, 404, 'مريض مستشفى آخر');
assert.equal((await call(patchPatient, { method: 'PATCH', token: T.reception, params: { id: p2 }, body: { full_name: 'سارة عثمان إبراهيم', phone: '0922222222', tenant_id: 'x' } })).status, 200);
assert.equal((await call(getPatient, { token: T.reception, params: { id: p2 } })).body.patient.full_name, 'سارة عثمان إبراهيم');
assert.ok((await call(listAudit, { token: T.admin })).body.events.some((e) => e.action === 'patient.update' && e.detail === 'full_name,phone'));

// ===== 6) نطاق المواعيد: الطبيب يرى مواعيده فقط ما لم يُمنح appointments.all =====
const list = async (t) => (await call(listAppts, { path: `/api/appointments?date=${day}`, token: t })).body.appointments;
const own = await list(T.doctor);
assert.ok(own.length >= 1 && own.every((a) => a.doctor_id === ids.doctor), 'الطبيب لا يرى إلا مواعيده');
assert.ok(own.some((a) => a.id === a1) && !own.some((a) => a.id === a2), 'موعد زميله غير ظاهر له');
assert.ok((await list(T.reception)).some((a) => a.id === a2), 'الاستقبال يرى مواعيد الجميع');
assert.equal((await call(patchAppt, { method: 'PATCH', token: T.doctor, params: { id: a2 }, body: { status: 'done' } })).status, 403, 'طبيب لا يعدّل موعد زميله');
assert.equal((await call(patchAppt, { method: 'PATCH', token: T.doctor, params: { id: a1 }, body: { status: 'cancelled' } })).status, 403, 'الطبيب لا يلغي');

// ===== 7) التخصيص لكل شخص =====
const getP = (t, id) => call(getPerms, { token: t, params: { id } });
const putP = (t, id, body) => call(putPerms, { method: 'PUT', token: t, params: { id }, body });
let info = await getP(T.admin, ids.reception);
assert.equal(info.status, 200); assert.equal(info.body.editable, true);
assert.deepEqual(info.body.defaults.sort(), [...ROLE_DEFAULTS.reception].sort());
assert.ok(info.body.catalog.length === CATALOG.length && !info.body.grantable.includes('staff.manage'), 'الحساسة غير قابلة للمنح من مدير المستشفى');
assert.equal((await getP(T.reception, ids.doctor)).status, 403, 'الاستقبال لا يرى محرّر الصلاحيات');
assert.equal((await getP(adminAmal, ids.reception)).status, 404, 'مستشفى آخر');
assert.equal((await getP(T.admin, 'nope')).status, 404);
assert.equal((await getP(T.admin, adminId)).body.editable, false, 'لا يعدّل المدير نفسه');

// منح وسحب بجلسة جارية: يسري فورًا
assert.equal((await call(listVisits, { token: T.reception, params: { id: p1 } })).status, 403);
assert.equal((await putP(T.admin, ids.reception, { grant: ['visits.read'], deny: ['patients.create'] })).status, 200);
assert.equal((await call(listVisits, { token: T.reception, params: { id: p1 } })).status, 200, 'المنح يسري فورًا بنفس الجلسة');
assert.equal((await post(addPatient, '/api/patients', { full_name: 'ممنوع التسجيل' }, { token: T.reception })).status, 403, 'السحب يسري فورًا');
assert.equal((await call(me, { token: T.reception })).body.permissions.includes('visits.read'), true);
assert.equal((await call(listStaff, { token: T.admin })).body.staff.find((s) => s.id === ids.reception).custom, 1, 'علامة «مخصص»');
assert.equal((await post(addVisit, '/api/x', { diagnosis: 'x' }, { token: T.reception, params: { id: p1 } })).status, 403, 'القراءة لا تمنح الكتابة');

// قيود التخصيص
assert.equal((await putP(T.admin, ids.reception, { grant: ['staff.manage'] })).status, 400, 'مدير المستشفى لا يمنح الحساسة');
assert.equal((await putP(T.admin, ids.reception, { grant: ['audit.view'] })).status, 400);
assert.equal((await putP(T.admin, ids.reception, { grant: ['nonsense.perm'] })).status, 400, 'صلاحية غير معروفة');
assert.equal((await putP(T.admin, ids.reception, { grant: ['visits.read'], deny: ['visits.read'] })).status, 400, 'منح وسحب معًا');
assert.equal((await putP(T.admin, ids.reception, { grant: 'visits.read' })).status, 400, 'صيغة خاطئة');
assert.equal((await putP(T.admin, adminId, { deny: ['audit.view'] })).status, 403, 'لا يعدّل نفسه');
assert.equal((await putP(T.reception, ids.doctor, { grant: ['invoices.read'] })).status, 403);
await mk(adminNoor, 'مدير ثانٍ', 'admin2@alnoor.com', 'admin');
const admin2Id = raw.prepare(`SELECT id FROM users WHERE email = 'admin2@alnoor.com'`).get().id;
assert.equal((await putP(T.admin, admin2Id, { deny: ['audit.view'] })).status, 403, 'صلاحيات المديرين لمدير المنصة وحده');

// التخصيص لا يخرج عن مستشفاه
assert.equal((await putP(adminAmal, ids.reception, { grant: ['invoices.read'] })).status, 404);

// تغيير الدور يصفّر التخصيصات
assert.equal((await call(patchStaff, { method: 'PATCH', token: T.admin, params: { id: ids.reception }, body: { role: 'accountant' } })).status, 200);
info = await getP(T.admin, ids.reception);
assert.deepEqual(info.body.overrides, { grant: [], deny: [] }, 'تصفير التخصيصات عند تغيير الدور');
await call(patchStaff, { method: 'PATCH', token: T.admin, params: { id: ids.reception }, body: { role: 'reception' } });

// إعادة التخصيص إلى الافتراضي
await putP(T.admin, ids.reception, { grant: ['visits.read'] });
assert.equal((await putP(T.admin, ids.reception, {})).status, 200);
assert.equal((await call(listStaff, { token: T.admin })).body.staff.find((s) => s.id === ids.reception).custom, 0);
assert.equal((await call(listVisits, { token: T.reception, params: { id: p1 } })).status, 403);

// appointments.all للطبيب
await putP(T.admin, ids.doctor, { grant: ['appointments.all'] });
assert.ok((await list(T.doctor)).some((a) => a.id === a2), 'منح appointments.all يكشف مواعيد الجميع');
assert.equal((await call(patchAppt, { method: 'PATCH', token: T.doctor, params: { id: a2 }, body: { status: 'done' } })).status, 200, 'ويتيح تعديلها');
await putP(T.admin, ids.doctor, {});

// منع التصعيد: من يملك staff.manage بمنح لا يصنع مديرًا ولا يعدّله
const platformGrant = (await call(pPutPerms, { method: 'PUT', token: platform, params: { id: tid.alnoor, uid: ids.reception }, body: { grant: ['staff.manage'] } }));
assert.equal(platformGrant.status, 200, 'مدير المنصة يمنح الحساسة');
assert.equal((await call(listStaff, { token: T.reception })).status, 200, 'استقبال ممنوح staff.manage يرى الموظفين');
assert.equal((await post(addStaff, '/api/staff', { name: 'مدير مدسوس', email: 'evil@alnoor.com', password: 'Staff-pass-7731', role: 'admin' }, { token: T.reception })).status, 403, 'لا يُنشئ مديرًا');
assert.equal((await call(patchStaff, { method: 'PATCH', token: T.reception, params: { id: ids.doctor }, body: { role: 'admin' } })).status, 403, 'لا يرقّي إلى مدير');
assert.equal((await call(patchStaff, { method: 'PATCH', token: T.reception, params: { id: adminId }, body: { active: false } })).status, 403, 'لا يوقف مديرًا');
assert.equal((await call(patchStaff, { method: 'PATCH', token: T.reception, params: { id: adminId }, body: { password: 'Hacked-pass-1234' } })).status, 403, 'لا يغيّر كلمة مدير');
await call(pPutPerms, { method: 'PUT', token: platform, params: { id: tid.alnoor, uid: ids.reception }, body: {} });

// ===== 8) محرّر مدير المنصة =====
const pGet = (uid) => call(pGetPerms, { token: platform, params: { id: tid.alnoor, uid } });
assert.equal((await pGet(admin2Id)).body.editable, true);
assert.ok((await pGet(ids.doctor)).body.grantable.includes('staff.manage'), 'مدير المنصة يملك منح الحساسة');
assert.equal((await call(pPutPerms, { method: 'PUT', token: platform, params: { id: tid.alnoor, uid: admin2Id }, body: { deny: ['audit.view'] } })).status, 200);
const admin2 = (await loginAs('alnoor', 'admin2@alnoor.com', 'Staff-pass-7731')).token;
assert.equal((await call(listAudit, { token: admin2 })).status, 403, 'سحب مدير المنصة لصلاحية من مدير يسري');
assert.equal((await call(pPutPerms, { method: 'PUT', token: platform, params: { id: tid.alamal, uid: ids.reception }, body: {} })).status, 404, 'موظف مستشفى آخر');
assert.equal((await call(pPutPerms, { method: 'PUT', token: platform, params: { id: tid.alnoor, uid: ids.doctor }, body: { grant: ['bogus'] } })).status, 400);
for (const role of ['admin', 'reception', 'doctor', 'accountant']) {
  assert.equal((await call(pGetPerms, { token: T[role], params: { id: tid.alnoor, uid: ids.doctor } })).status, 403, 'غير مدير المنصة: ' + role);
}
assert.equal((await call(pStaffList, { token: platform, params: { id: tid.alnoor } })).body.staff.find((s) => s.id === admin2Id).custom, 1);

console.log('rbac: كل الاختبارات نجحت');
