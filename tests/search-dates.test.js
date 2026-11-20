// اختبار البحث عن المرضى (رقم الملف)، ومنع الحجز في الماضي بكل مستوياته، وفحص سلامة القاعدة، ورسالة الترحيل الناقص.
import assert from 'node:assert/strict';
import { makeDb } from './d1-shim.js';
import { parsePatientQuery } from '../lib/search.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequestPost as setup } from '../functions/api/setup.js';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { onRequestPost as createTenant } from '../functions/api/platform/tenants.js';
import { onRequestGet as listPatients, onRequestPost as addPatient } from '../functions/api/patients/index.js';
import { onRequestPost as addAppt } from '../functions/api/appointments/index.js';
import { onRequestPost as addInvoice } from '../functions/api/invoices/index.js';
import { onRequestPost as payInvoice } from '../functions/api/invoices/[id]/pay.js';
import { onRequestPost as addStaff } from '../functions/api/staff/index.js';
import { onRequestGet as health } from '../functions/api/platform/health.js';

// ===== 0) تحليل نص البحث =====
assert.deepEqual(parsePatientQuery('  '), { kind: 'recent' });
assert.deepEqual(parsePatientQuery('٣'), { kind: 'number', digits: '3' }, 'أرقام هندية');
assert.deepEqual(parsePatientQuery('۱۲'), { kind: 'number', digits: '12' }, 'أرقام فارسية');
assert.deepEqual(parsePatientQuery('ملف 12'), { kind: 'number', digits: '12' });
assert.deepEqual(parsePatientQuery('رقم الملف: ٧'), { kind: 'number', digits: '7' });
assert.deepEqual(parsePatientQuery('#5'), { kind: 'number', digits: '5' });
assert.deepEqual(parsePatientQuery('+249 91 234 5678'), { kind: 'number', digits: '0912345678' }, 'رمز السودان الدولي');
assert.deepEqual(parsePatientQuery('249912345678'), { kind: 'number', digits: '0912345678' });
assert.deepEqual(parsePatientQuery('هدى'), { kind: 'text', text: 'هدى' });

// ===== تجهيز =====
const env = { DB: makeDb(), JWT_SECRET: 'sd-test-secret-'.padEnd(48, 'x'), SETUP_KEY: 'k' };
const raw = env.DB.raw;
let n = 0;
const call = async (handler, { path = '/api/x', method = 'GET', body, token, params = {} } = {}) => {
  const request = new Request(`https://x.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.7.${Math.floor(++n / 250)}.${n % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = {};
  const res = await middleware({ request, env, data, next: async () => handler({ request, env, data, params }) });
  return { status: res.status, body: await res.json() };
};
const post = (h, path, body, o = {}) => call(h, { path, method: 'POST', body, ...o });
const loginAs = async (slug, email, pw) => (await post(login, '/api/auth/login', { slug, email, password: pw })).body.token;
await post(setup, '/api/setup', { key: 'k', email: 'root@x.com', name: 'مدير المنصة', password: 'Zebra-5521-kx' });
const platform = await loginAs('platform', 'root@x.com', 'Zebra-5521-kx');
await post(createTenant, '/api/platform/tenants', { name: 'الخرطوم', slug: 'khartoum', admin_email: 'admin@kh.com', admin_name: 'مدير', admin_password: 'Hospital-8842' }, { token: platform });
const admin = await loginAs('khartoum', 'admin@kh.com', 'Hospital-8842');
const mk = async (name, email, role) => (await post(addStaff, '/api/staff', { name, email, password: 'Staff-pass-7731', role }, { token: admin })).body.id;
const docId = await mk('د. أحمد', 'doc@kh.com', 'doctor');
await mk('استقبال', 'front@kh.com', 'reception'); await mk('محاسب', 'acc@kh.com', 'accountant');
const front = await loginAs('khartoum', 'front@kh.com', 'Staff-pass-7731');
const acc = await loginAs('khartoum', 'acc@kh.com', 'Staff-pass-7731');

// ===== 1) البحث برقم الملف (الحالة التي أبلغ عنها المستخدم: أرقام هواتف تحتوي نفس الرقم) =====
const mkPatient = async (name, phone) => (await post(addPatient, '/api/patients', { full_name: name, phone }, { token: front })).body;
const pHuda = await mkPatient('هدى', '0912345678'), pHashim = await mkPatient('هاشم', '0912345677'), pHamid = await mkPatient('حامد', '0912345666');
assert.deepEqual([pHuda.file_no, pHashim.file_no, pHamid.file_no], ['1', '2', '3']);
const find = async (q) => (await call(listPatients, { path: '/api/patients?q=' + encodeURIComponent(q), token: front })).body.patients.map((p) => `${p.file_no}:${p.full_name}`);
assert.deepEqual(await find('3'), ['3:حامد'], 'الرقم 3 يعيد الملف 3 وحده (لا كل الهواتف التي تحتوي 3)');
assert.deepEqual(await find('1'), ['1:هدى']);
assert.deepEqual(await find('٣'), ['3:حامد'], 'أرقام هندية');
assert.deepEqual(await find('ملف 2'), ['2:هاشم']);
assert.deepEqual(await find('#2'), ['2:هاشم']);
assert.deepEqual(await find('رقم الملف ٢'), ['2:هاشم']);
assert.deepEqual(await find('99'), [], 'ملف غير موجود');
assert.deepEqual(await find('0912345677'), ['2:هاشم'], 'الهاتف الكامل');
assert.deepEqual(await find('+249912345677'), ['2:هاشم'], 'الهاتف بالصيغة الدولية');
assert.equal((await find('2345')).length, 3, 'جزء من الهاتف (4 خانات فأكثر) يطابق الهواتف');
assert.deepEqual(await find('حامد'), ['3:حامد']); assert.deepEqual(await find('هد'), ['1:هدى']);
assert.equal((await find('')).length, 3, 'بلا نص: الأحدث');
// ملف رقمه 12 (ثنائي الخانة) لا يختلط بـ1 و2
for (let i = 4; i <= 12; i++) await mkPatient('مريض ' + i, '0900000' + String(i).padStart(3, '0'));
assert.deepEqual(await find('1'), ['1:هدى'], 'البحث عن 1 لا يعيد 10 و11 و12');
assert.deepEqual(await find('12'), ['12:مريض 12']);
// أولوية رقم الملف المطابق عندما يطابق الرقم الطويل ملفًا وهاتفًا
raw.prepare("UPDATE patients SET file_no = '4444' WHERE full_name = 'مريض 4'").run();
raw.prepare("UPDATE patients SET phone = '0924444000' WHERE full_name = 'مريض 5'").run();
assert.equal((await find('4444'))[0], '4444:مريض 4', 'الملف المطابق بالضبط يتصدر');
// عزل المستشفيات في البحث
await post(createTenant, '/api/platform/tenants', { name: 'الأمل', slug: 'amal', admin_email: 'admin@amal.com', admin_name: 'مدير', admin_password: 'Hospital-8842' }, { token: platform });
const adminAmal = await loginAs('amal', 'admin@amal.com', 'Hospital-8842');
await post(addStaff, '/api/staff', { name: 'استقبال الأمل', email: 'front@amal.com', password: 'Staff-pass-7731', role: 'reception' }, { token: adminAmal });
const frontAmal = await loginAs('amal', 'front@amal.com', 'Staff-pass-7731');
await post(addPatient, '/api/patients', { full_name: 'مريض الأمل', phone: '0912345999' }, { token: frontAmal });
assert.deepEqual((await call(listPatients, { path: '/api/patients?q=1', token: frontAmal })).body.patients.map((p) => p.full_name), ['مريض الأمل'], 'ملف 1 في الأمل غير ملف 1 عندنا');

// ===== 2) منع الحجز في الماضي: السنة والشهر واليوم والساعة والدقيقة =====
const ms = (m) => new Date(Date.now() + 2 * 3600 * 1000 + m * 60000);                // الآن بالخرطوم + دقائق
const fmt = (d) => d.toISOString().slice(0, 16).replace('T', ' ');
const quarter = (d, up) => { const x = new Date(d); x.setUTCSeconds(0, 0); const m = x.getUTCMinutes(); const q = up ? Math.ceil(m / 15) * 15 : Math.floor(m / 15) * 15; x.setUTCMinutes(q); return x; };
const book = (at) => post(addAppt, '/api/appointments', { patient_id: pHuda.id, doctor_id: docId, starts_at: at }, { token: front });
const yearsAgo = (k) => { const x = ms(0); x.setUTCFullYear(x.getUTCFullYear() - k); return fmt(quarter(x, false)); };
const monthsAgo = (k) => { const x = ms(0); x.setUTCMonth(x.getUTCMonth() - k); return fmt(quarter(x, false)); };
const PAST = 'لا يمكن الحجز في وقت مضى';
for (const [label, at] of [
  ['قبل سنة', yearsAgo(1)], ['قبل 10 سنوات', yearsAgo(10)], ['قبل شهر', monthsAgo(1)], ['قبل 7 أشهر', monthsAgo(7)],
  ['أمس', fmt(quarter(ms(-24 * 60), false))], ['قبل ساعتين', fmt(quarter(ms(-120), false))], ['قبل ساعة', fmt(quarter(ms(-60), false))],
  ['قبل 15 دقيقة', fmt(quarter(ms(-15), false))],
]) {
  const r = await book(at);
  assert.equal(r.status, 400, `${label} (${at}) يجب أن يُرفض`);
  assert.ok(r.body.error.includes(PAST), `${label}: رسالة واضحة`);
}
const countAppts = () => raw.prepare('SELECT COUNT(*) AS n FROM appointments').get().n;
assert.equal(countAppts(), 0, 'الطلبات المرفوضة لا تترك أثرًا');
// المستقبل مقبول بكل مستوياته
for (const [label, at] of [
  ['بعد ساعة', fmt(quarter(ms(60), true))], ['بعد 15 دقيقة فأكثر', fmt(quarter(ms(31), true))],
  ['غدًا', fmt(quarter(ms(24 * 60), true))], ['بعد شهر', (() => { const x = ms(0); x.setUTCMonth(x.getUTCMonth() + 1); return fmt(quarter(x, true)); })()],
]) {
  const r = await post(addAppt, '/api/appointments', { patient_id: pHuda.id, doctor_id: docId, starts_at: at }, { token: front });
  assert.equal(r.status, 201, `${label} (${at}) مقبول: ${JSON.stringify(r.body)}`);
}
// الحد الأقصى: سنتان من اليوم (يحمي من خطأ كتابة السنة)
const farDay = (days) => { const x = ms(0); x.setUTCDate(x.getUTCDate() + days); return fmt(quarter(x, true)).slice(0, 10) + ' 10:00'; };
assert.equal((await book(farDay(730))).status, 201, 'اليوم رقم 730 مقبول');
const tooFar = await book(farDay(731));
assert.equal(tooFar.status, 400); assert.ok(tooFar.body.error.includes('بعيد جدًا'));
assert.equal((await book(`${new Date().getUTCFullYear() + 20}-01-01 10:00`)).status, 400, 'سنة بعيدة جدًا');
// الصيغة الخاطئة ما زالت تُرفض كما كانت
assert.equal((await book('2026-13-40 10:00')).status, 400); assert.equal((await book('غدًا')).status, 400);

// ===== 3) فحص سلامة القاعدة =====
let h = await call(health, { token: platform });
assert.equal(h.status, 200); assert.deepEqual(h.body, { ok: true, missing: [] }, 'كل الترحيلات مطبّقة');
for (const role of [admin, front, acc]) assert.equal((await call(health, { token: role })).status, 403, 'مدير المنصة وحده');
assert.equal((await call(health, {})).status, 401);

// الفاتورة قبل حذف الجدول
const pid = pHuda.id;
const inv = (await post(addInvoice, '/api/invoices', { patient_id: pid, total: 1000 }, { token: acc })).body.id;
assert.equal((await post(payInvoice, '/api/x', { amount: 100, method: 'cash' }, { token: acc, params: { id: inv } })).status, 200);

// ترحيل ناقص: يُحذف جدول الدفعات كما لو لم يُشغَّل الملف 005
raw.exec('DROP INDEX uq_payment_ref; DROP INDEX idx_payments_invoice; DROP INDEX idx_payments_time; DROP TABLE payments;');
h = await call(health, { token: platform });
assert.equal(h.body.ok, false);
assert.deepEqual(h.body.missing.map((m) => m.migration), ['005_payments.sql', '005_payments.sql'], 'يحدد ملف الترحيل الناقص');
assert.ok(h.body.missing.some((m) => m.item === 'جدول payments') && h.body.missing.some((m) => m.item === 'فهرس uq_payment_ref'));
const broken = await post(payInvoice, '/api/x', { amount: 100, method: 'cash' }, { token: acc, params: { id: inv } });
assert.equal(broken.status, 503, 'بدل «خطأ داخلي»: رسالة تدل على الترحيل');
assert.ok(broken.body.error.includes('ترحيل') && !/payments|sqlite|no such/i.test(broken.body.error), 'الرسالة واضحة ولا تكشف تفاصيل القاعدة');
// أخطاء أخرى تبقى «خطأ داخلي» عامة
const genericEnv = { ...env, DB: undefined };
const request = new Request('https://x.test/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'a', email: 'b@c.com', password: 'x' }) });
const g = await middleware({ request, env: genericEnv, data: {}, next: async () => login({ request, env: genericEnv }) });
assert.equal(g.status, 500);

console.log('search-dates: كل الاختبارات نجحت');
