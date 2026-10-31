import { fail, json } from '../../../lib/http.js';
import { has } from '../../../lib/permissions.js';
import { repoFor } from '../../../lib/repo.js';

// ملخص إدارة اليوم: إيراد (حسب طريقة الدفع)، رصيد غير محصّل، مرضى، مواعيد اليوم، مواعيد فائتة، وإيراد آخر 7 أيام.
// الأيام بتوقيت الخرطوم (UTC+2). أعداد ومجاميع فقط، والفائتة تُظهر اسم المريض لمن يملك patients.read.
const KHARTOUM_OFFSET = 2 * 3600 * 1000;

function shift(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export async function onRequestGet({ request, env, data }) {
  if (!has(data.auth, 'reports.view')) return fail(403, 'غير مسموح');
  const now = new Date(Date.now() + KHARTOUM_OFFSET);
  const date = new URL(request.url).searchParams.get('date') || now.toISOString().slice(0, 10);
  if (!validDate(date)) return fail(400, 'التاريخ بصيغة YYYY-MM-DD');
  const nowLocal = now.toISOString().slice(0, 16).replace('T', ' ');
  const from = shift(date, -6);

  const r = await repoFor(env, data.auth).reports.summary({ date, from, nowLocal });

  const by = { cash: { n: 0, total: 0 }, bankak: { n: 0, total: 0 }, other: { n: 0, total: 0 } };
  for (const m of r.byMethod) by[m.method] = { n: m.n, total: m.total };
  const status = { done: 0, scheduled: 0, cancelled: 0, no_show: 0 };
  for (const a of r.appts) status[a.status] = a.n;
  const perDay = Object.fromEntries(r.series.map((x) => [x.day, x.total]));
  const series = Array.from({ length: 7 }, (_, i) => { const d = shift(from, i); return { date: d, total: perDay[d] || 0 }; });
  const names = has(data.auth, 'patients.read');

  return json({
    date,
    revenue: { total: by.cash.total + by.bankak.total + by.other.total, count: by.cash.n + by.bankak.n + by.other.n, by_method: by },
    outstanding: { count: r.open.n, total: r.open.total },
    issued: { count: r.issued.n, total: r.issued.total },
    patients: { total: r.patients.total, new_today: r.patients.today },
    appointments: { total: status.done + status.scheduled + status.cancelled + status.no_show, ...status },
    overdue: { count: r.overdueCount.n, items: r.overdueItems.map((a) => ({ id: a.id, starts_at: a.starts_at, patient_name: names ? a.patient_name : null, doctor_name: a.doctor_name })) },
    series,
  });
}
