import { fail, json, readJson } from '../../../../lib/http.js';
import { has } from '../../../../lib/permissions.js';
import { repoFor } from '../../../../lib/repo.js';

// تحصيل دفعة على فاتورة مفتوحة، بحيث لا يتجاوز المجموع قيمة الفاتورة
export async function onRequestPost({ request, params, env, data }) {
  if (!has(data.auth, 'invoices.collect')) return fail(403, 'غير مسموح');
  const b = await readJson(request);
  const amount = Number(b?.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000) return fail(400, 'المبلغ رقم صحيح موجب');

  const repo = repoFor(env, data.auth);
  if (!(await repo.invoices.get(params.id))) return fail(404, 'الفاتورة غير موجودة');
  if (!(await repo.invoices.collect(params.id, amount))) return fail(409, 'المبلغ يتجاوز المتبقي، أو الفاتورة مغلقة أو ملغاة');
  await repo.audit.log('invoice.pay', params.id.slice(0, 8), String(amount));
  return json({ ok: true });
}
