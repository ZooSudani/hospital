// اختبار الدفعات (طريقة الدفع ورقم العملية) وتقارير الإدارة، بما فيها حدود اليوم بتوقيت الخرطوم.
import assert from 'node:assert/strict';
import { makeDb } from './d1-shim.js';
import { guardedBatch, IsolationError } from '../lib/isolation/executors.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequestPost as setup } from '../functions/api/setup.js';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { onRequestPost as createTenant } from '../functions/api/platform/tenants.js';
import { onRequestPost as addPatient } from '../functions/api/patients/index.js';
import { onRequestPost as addAppt } from '../functions/api/appointments/index.js';
import { onRequestPatch as patchAppt } from '../functions/api/appointments/[id].js';
import { onRequestGet as listInvoices, onRequestPost as addInvoice } from '../functions/api/invoices/index.js';
import { onRequestPatch as patchInvoice } from '../functions/api/invoices/[id].js';
import { onRequestPost as payInvoice } from '../functions/api/invoices/[id]/pay.js';
import { onRequestGet as listPayments } from '../functions/api/invoices/[id]/payments.js';
import { onRequestGet as reportSummary } from '../functions/api/reports/summary.js';
import { onRequestPost as addStaff } from '../functions/api/staff/index.js';
import { onRequestPut as putPerms } from '../functions/api/staff/[id]/permissions.js';
import { onRequestGet as listAudit } from '../functions/api/audit.js';

const env = { DB: makeDb(), JWT_SECRET: 'pay-test-secret-'.padEnd(48, 'x'), SETUP_KEY: 'k' };
const raw = env.DB.raw;
let n = 0;
const call = async (handler, { path = '/api/x', method = 'GET', body, token, params = {} } = {}) => {
  const request = new Request(`https://x.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.8.${Math.floor(++n / 250)}.${n % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = {};
  const res = await middleware({ request, env, data, next: async () => handler({ request, env, data, params }) });
  return { status: res.status, body: await res.json() };
};
const post = (h, path, body, o = {}) => call(h, { path, method: 'POST', body, ...o });
const loginAs = async (slug, email, pw) => (await post(login, '/api/auth/login', { slug, email, password: pw })).body.token;

// ===== تجهيز: مستشفيان =====
await post(setup, '/api/setup', { key: 'k', email: 'root@x.com', name: 'مدير المنصة', password: 'Zebra-5521-kx' });
const platform = await loginAs('platform', 'root@x.com', 'Zebra-5521-kx');
for (const slug of ['alnoor', 'alamal']) await post(createTenant, '/api/platform/tenants', { name: slug, slug, admin_email: `admin@${slug}.com`, admin_name: 'مدير ' + slug, admin_password: 'Hospital-8842' }, { token: platform });
const adminNoor = await loginAs('alnoor', 'admin@alnoor.com', 'Hospital-8842');
const adminAmal = await loginAs('alamal', 'admin@alamal.com', 'Hospital-8842');
const mk = async (token, name, email, role) => (await post(addStaff, '/api/staff', { name, email, password: 'Staff-pass-7731', role }, { token })).body.id;
const ids = { acc: await mk(adminNoor, 'عمر', 'omar@alnoor.com', 'accountant'), rec: await mk(adminNoor, 'ريم', 'reem@alnoor.com', 'reception'), doc: await mk(adminNoor, 'د. هالة', 'hala@alnoor.com', 'doctor') };
await mk(adminAmal, 'محاسب الأمل', 'acc@alamal.com', 'accountant');
const T = {
  admin: adminNoor,
  acc: await loginAs('alnoor', 'omar@alnoor.com', 'Staff-pass-7731'),
  rec: await loginAs('alnoor', 'reem@alnoor.com', 'Staff-pass-7731'),
  doc: await loginAs('alnoor', 'hala@alnoor.com', 'Staff-pass-7731'),
  amalAcc: await loginAs('alamal', 'acc@alamal.com', 'Staff-pass-7731'),
};
const p1 = (await post(addPatient, '/api/patients', { full_name: 'أحمد محمد علي' }, { token: T.rec })).body.id;
const p2 = (await post(addPatient, '/api/patients', { full_name: 'سارة عثمان' }, { token: T.rec })).body.id;
const p3 = (await post(addPatient, '/api/patients', { full_name: 'خالد قديم' }, { token: T.rec })).body.id;
const pAmal = (await post(addPatient, '/api/patients', { full_name: 'مريض الأمل' }, { token: adminAmal })).body.id;
const invoice = async (token, patient, total) => (await post(addInvoice, '/api/invoices', { patient_id: patient, total }, { token })).body.id;
const pay = (token, id, body) => post(payInvoice, '/api/x', body, { token, params: { id } });
const payments = (token, id) => call(listPayments, { token, params: { id } });
const countPayments = () => raw.prepare('SELECT COUNT(*) AS n FROM payments').get().n;
const paidOf = (id) => ({ ...raw.prepare('SELECT paid, status FROM invoices WHERE id = ?').get(id) });

// ===== 1) التحقق من المدخلات =====
const i1 = await invoice(T.acc, p1, 5000);
assert.equal((await pay(T.acc, i1, { amount: 100 })).status, 400, 'طريقة الدفع مطلوبة');
assert.equal((await pay(T.acc, i1, { amount: 100, method: 'visa' })).status, 400, 'طريقة غير معروفة');
assert.equal((await pay(T.acc, i1, { amount: 100, method: 'bankak' })).status, 400, 'بنكك يتطلب رقم عملية');
assert.equal((await pay(T.acc, i1, { amount: 100, method: 'bankak', reference: '!!' })).status, 400, 'رقم عملية بمحارف غير مسموحة');
assert.equal((await pay(T.acc, i1, { amount: 100, method: 'bankak', reference: 'a'.repeat(41) })).status, 400, 'رقم عملية أطول من المسموح');
assert.equal((await pay(T.acc, i1, { amount: 0, method: 'cash' })).status, 400);
assert.equal((await pay(T.acc, i1, { amount: 10.5, method: 'cash' })).status, 400);
assert.equal(countPayments(), 0, 'الطلبات المرفوضة لا تترك أثرًا');

// ===== 2) الدفعات: نقد وبنكك وأخرى =====
let r = await pay(T.acc, i1, { amount: 2000, method: 'cash', reference: 'IGNORED-123' });
assert.equal(r.status, 200); assert.ok(r.body.payment_id);
r = await pay(T.acc, i1, { amount: 1000, method: 'bankak', reference: 'BK 2026 7788' });
assert.equal(r.status, 200);
let list = (await payments(T.acc, i1)).body.payments;
assert.equal(list.length, 2);
assert.equal(list[0].method, 'bankak'); assert.equal(list[0].reference, 'BK20267788', 'تُزال المسافات من رقم العملية');
assert.equal(list[1].method, 'cash'); assert.equal(list[1].reference, null, 'النقد بلا رقم عملية');
assert.ok(list.every((p) => p.collector === 'عمر' && !('tenant_id' in p)), 'المحصِّل مسجّل ولا يُرجَع tenant_id');
assert.deepEqual(paidOf(i1), { paid: 3000, status: 'open' });

// ===== 3) رقم العملية لا يتكرر، والمعاملة ذرية =====
const before = countPayments();
assert.equal((await pay(T.acc, i1, { amount: 500, method: 'bankak', reference: 'bk20267788' })).status, 200, 'المطابقة حساسة لحالة الأحرف (رقم مختلف)');
assert.equal((await pay(T.acc, i1, { amount: 500, method: 'bankak', reference: 'BK20267788' })).status, 409, 'رقم عملية مكرر');
assert.equal(countPayments(), before + 1, 'الدفعة المرفوضة لا تُسجَّل');
assert.deepEqual(paidOf(i1), { paid: 3500, status: 'open' }, 'ولا تغيّر رصيد الفاتورة (المعاملة أُلغيت كلها)');
assert.equal((await pay(T.acc, i1, { amount: 100, method: 'other', reference: 'BK20267788' })).status, 200, 'الطريقة جزء من التفرد: «أخرى» برقم مماثل مسموحة');
const iAmal = await invoice(T.amalAcc, pAmal, 800);
assert.equal((await pay(T.amalAcc, iAmal, { amount: 100, method: 'bankak', reference: 'BK20267788' })).status, 200, 'نفس الرقم في مستشفى آخر مسموح');

// ===== 4) التجاوز والفواتير المغلقة لا تترك أثرًا =====
const i2 = await invoice(T.acc, p2, 1000);
const c0 = countPayments();
assert.equal((await pay(T.acc, i2, { amount: 1500, method: 'cash' })).status, 409, 'تجاوز قيمة الفاتورة');
assert.equal(countPayments(), c0, 'لا دفعة عند التجاوز');
assert.equal((await pay(T.acc, i2, { amount: 1000, method: 'cash' })).status, 200);
assert.deepEqual(paidOf(i2), { paid: 1000, status: 'paid' });
assert.equal((await pay(T.acc, i2, { amount: 1, method: 'cash' })).status, 409, 'فاتورة مسددة');
const i3 = await invoice(T.acc, p2, 300);
assert.equal((await call(patchInvoice, { method: 'PATCH', token: T.acc, params: { id: i3 }, body: { status: 'void' } })).status, 200);
assert.equal((await pay(T.acc, i3, { amount: 1, method: 'cash' })).status, 409, 'فاتورة ملغاة');
assert.equal(countPayments(), c0 + 1, 'لم تُسجَّل أي دفعة على المغلقة أو الملغاة');
// دفعتان متزامنتان على فاتورة واحدة: واحدة فقط تنجح
const i4 = await invoice(T.acc, p1, 1000);
const both = await Promise.all([pay(T.acc, i4, { amount: 600, method: 'cash' }), pay(T.acc, i4, { amount: 600, method: 'cash' })]);
assert.deepEqual(both.map((x) => x.status).sort(), [200, 409], 'دفعتان متزامنتان: تنجح إحداهما فقط');
assert.equal(paidOf(i4).paid, 600);

// ===== 5) تطابق الدفعات مع أرصدة الفواتير (تدقيق محاسبي) =====
const mism = raw.prepare(`SELECT i.id FROM invoices i WHERE i.paid <> COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.tenant_id = i.tenant_id), 0)`).all();
assert.equal(mism.length, 0, 'مجموع الدفعات يساوي المدفوع في كل فاتورة');

// ===== 6) الصلاحيات والعزل =====
for (const who of ['doc', 'rec']) assert.equal((await payments(T[who], i1)).status, 403, who + ' لا يقرأ الدفعات');
assert.equal((await payments(T.admin, i1)).status, 200, 'المدير يقرأ الدفعات');
assert.equal((await payments(T.amalAcc, i1)).status, 404, 'محاسب مستشفى آخر لا يرى دفعاتنا');
assert.equal((await payments(T.acc, 'nope')).status, 404);
assert.equal((await pay(T.admin, i4, { amount: 1, method: 'cash' })).status, 403, 'المدير لا يحصّل');
assert.equal((await pay(T.amalAcc, i1, { amount: 1, method: 'cash' })).status, 404, 'عزل التحصيل');
const ev = (await call(listAudit, { token: T.admin })).body.events.filter((e) => e.action === 'invoice.pay');
assert.ok(ev.some((e) => e.detail === 'bankak:1000') && ev.some((e) => e.detail === 'cash:2000'), 'سجل النشاط يحوي الطريقة والمبلغ');
assert.ok(!JSON.stringify(ev).includes('BK2026'), 'ولا يحوي رقم العملية');

// ===== 7) الحارس: الدفعات الذرية تمرّ بالفحص الساكن =====
const batch = guardedBatch(env.DB);
await assert.rejects(() => batch([{ sql: `UPDATE invoices SET paid = 1 WHERE tenant_id = ? AND id = ?`, args: ['x', 'y'] }, { sql: 'UPDATE invoices SET paid = 999', args: [] }]), (e) => e instanceof IsolationError && e.code === 'missing-tenant-filter');
assert.deepEqual(paidOf(i1), { paid: 3600, status: 'open' }, 'العبارة المرفوضة لم تُنفَّذ ولا شقيقتها');

// ===== 8) تقارير الإدارة =====
const khartoum = (offsetMs = 0) => new Date(Date.now() + 2 * 3600 * 1000 + offsetMs);
const today = khartoum().toISOString().slice(0, 10);
const nowLocal = khartoum().toISOString().slice(0, 16).replace('T', ' ');
const dayShift = (d, k) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const yesterday = dayShift(today, -1), tomorrow = dayShift(today, 1);
const summary = (token, q = '') => call(reportSummary, { path: '/api/reports/summary' + q, token });

// تجهيز أوقات الدفعات بدقة: ثلاث دفعات في «اليوم» وواحدة أمس وواحدة بعد منتصف الليل بتوقيت الخرطوم
raw.prepare('DELETE FROM payments').run();
raw.prepare("UPDATE invoices SET paid = 0, status = 'open'").run();
const rep = await invoice(T.acc, p1, 10000);
const payAt = async (amount, method, ref, createdUtc) => {
  const x = await pay(T.acc, rep, { amount, method, reference: ref });
  assert.equal(x.status, 200);
  raw.prepare('UPDATE payments SET created_at = ? WHERE id = ?').run(createdUtc, x.body.payment_id);
};
await payAt(2000, 'cash', null, `${today} 09:00:00`);                         // اليوم (UTC=09:00 → 11:00 خرطوم)
await payAt(1500, 'bankak', 'RPT-1', `${dayShift(today, -1)} 22:30:00`);      // 00:30 خرطوم من اليوم (يُحسب اليوم)
await payAt(500, 'other', null, `${today} 21:30:00`);                          // 23:30 خرطوم اليوم (يُحسب اليوم)
await payAt(700, 'cash', null, `${today} 22:30:00`);                           // 00:30 خرطوم من الغد (لا يُحسب اليوم)
await payAt(300, 'cash', null, `${dayShift(today, -3)} 10:00:00`);            // قبل 3 أيام
let rp = (await summary(T.admin)).body;
assert.equal(rp.date, today);
assert.equal(rp.revenue.total, 4000, 'إيراد اليوم: يشمل بعد منتصف الليل بتوقيت الخرطوم ويستثني الغد');
assert.deepEqual(rp.revenue.by_method, { cash: { n: 1, total: 2000 }, bankak: { n: 1, total: 1500 }, other: { n: 1, total: 500 } });
assert.equal(rp.revenue.count, 3);
assert.equal(rp.series.length, 7); assert.equal(rp.series[6].date, today); assert.equal(rp.series[0].date, dayShift(today, -6));
assert.equal(rp.series[6].total, 4000); assert.equal(rp.series[3].date, dayShift(today, -3)); assert.equal(rp.series[3].total, 300);
assert.equal(rp.series.filter((x) => x.total === 0).length, 5, 'الأيام الخالية تُملأ بصفر');
assert.equal((await summary(T.admin, `?date=${tomorrow}`)).body.revenue.total, 700, 'تقرير الغد: الدفعة التي بعد منتصف الليل');
assert.equal((await summary(T.admin, `?date=${dayShift(today, -3)}`)).body.revenue.total, 300, 'تقرير يوم سابق');
assert.equal(rp.outstanding.count, raw.prepare("SELECT COUNT(*) AS n FROM invoices WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alnoor') AND status = 'open'").get().n);
assert.equal(rp.outstanding.total, raw.prepare("SELECT SUM(total - paid) AS s FROM invoices WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alnoor') AND status = 'open'").get().s, 'رصيد غير محصّل = المتبقي على المفتوحة');
assert.equal(rp.issued.count, raw.prepare("SELECT COUNT(*) AS n FROM invoices WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'alnoor') AND status <> 'void' AND date(created_at, '+2 hours') = ?").get(today).n);

// المرضى
raw.prepare("UPDATE patients SET created_at = datetime('now', '-3 days') WHERE id = ?").run(p3);
rp = (await summary(T.admin)).body;
assert.equal(rp.patients.total, 3); assert.equal(rp.patients.new_today, 2, 'الجدد اليوم: بلا القديم');

// المواعيد: اليوم بحالاته، والفائتة (محجوزة مضى وقتها)
const book = async (patient, at) => (await post(addAppt, '/api/appointments', { patient_id: patient, doctor_id: ids.doc, starts_at: at }, { token: T.rec })).body.id;
const aDone = await book(p1, `${today} 07:00`), aNo = await book(p2, `${today} 07:15`), aCancel = await book(p1, `${today} 07:30`);
await book(p2, `${today} 07:45`);
const aOld = await book(p1, `${yesterday} 10:00`), aFuture = await book(p2, `${tomorrow} 10:00`);
for (const [id, status] of [[aDone, 'done'], [aNo, 'no_show'], [aCancel, 'cancelled']]) assert.equal((await call(patchAppt, { method: 'PATCH', token: T.rec, params: { id }, body: { status } })).status, 200);
rp = (await summary(T.admin)).body;
assert.deepEqual(rp.appointments, { total: 4, done: 1, scheduled: 1, cancelled: 1, no_show: 1 });
const expectedOverdue = ['07:45', '10:00'].length ? [`${today} 07:45`, `${yesterday} 10:00`].filter((x) => x < nowLocal).length : 0;
assert.equal(rp.overdue.count, expectedOverdue, 'الفائتة: محجوزة مضى وقتها (وليست «تمت» ولا «لم يحضر» ولا ملغاة)');
assert.ok(rp.overdue.items.some((x) => x.id === aOld && x.patient_name === 'أحمد محمد علي'), 'موعد الأمس المحجوز فائت');
assert.ok(!rp.overdue.items.some((x) => x.id === aFuture), 'موعد الغد ليس فائتًا');
assert.ok(rp.overdue.items.every((x, i, a) => i === 0 || a[i - 1].starts_at >= x.starts_at), 'الأحدث أولًا');
assert.equal((await summary(T.admin, `?date=${yesterday}`)).body.appointments.scheduled, 1, 'مواعيد يوم سابق حسب تاريخه');

// عزل المستشفيات: تقرير الأمل لا يرى أرقام النور
const iAmal2 = await invoice(T.amalAcc, pAmal, 800);
assert.equal((await pay(T.amalAcc, iAmal2, { amount: 100, method: 'cash' })).status, 200);
const ra = (await summary(T.amalAcc)).body;
assert.equal(ra.revenue.total, 100, 'إيراد الأمل: دفعته الوحيدة'); assert.equal(ra.patients.total, 1); assert.equal(ra.appointments.total, 0); assert.equal(ra.overdue.count, 0);
assert.ok(!JSON.stringify(ra).includes('أحمد') && !JSON.stringify(ra).includes('سارة'), 'لا أسماء من مستشفى آخر');
assert.ok(!JSON.stringify(rp).includes('tenant_id'), 'لا tenant_id في الرد');

// الصلاحيات
assert.equal((await summary(T.acc)).status, 200, 'المحاسب يرى التقارير');
assert.equal((await summary(T.rec)).status, 403); assert.equal((await summary(T.doc)).status, 403);
assert.equal((await summary(T.admin, '?date=bad')).status, 400); assert.equal((await summary(T.admin, '?date=2026-02-31')).status, 400);
assert.equal((await call(reportSummary, {})).status, 401);
const grant = (id, body) => call(putPerms, { method: 'PUT', token: T.admin, params: { id }, body });
assert.equal((await grant(ids.rec, { grant: ['reports.view'] })).status, 200);
assert.equal((await summary(T.rec)).status, 200, 'منح reports.view يسري فورًا');
assert.equal((await summary(T.rec)).body.overdue.items[0].patient_name !== null, true, 'الاستقبال يملك patients.read فيرى الأسماء');
assert.equal((await grant(ids.acc, { deny: ['patients.read'] })).status, 200);
const noNames = (await summary(T.acc)).body;
assert.ok(noNames.overdue.count > 0 && noNames.overdue.items.every((x) => x.patient_name === null), 'من لا يملك patients.read لا يرى أسماء الفائتة');
assert.equal(noNames.revenue.total, 4000, 'وتبقى الأرقام');
await grant(ids.acc, {}); await grant(ids.rec, {});

console.log('payments-reports: كل الاختبارات نجحت');
