import { fail, json } from '../../../../lib/http.js';
import { has } from '../../../../lib/permissions.js';
import { repoFor } from '../../../../lib/repo.js';

// سجل دفعات فاتورة (الإيصالات): من يقرأ الفواتير يقرأ دفعاتها
export async function onRequestGet({ params, env, data }) {
  if (!has(data.auth, 'invoices.read')) return fail(403, 'غير مسموح');
  const repo = repoFor(env, data.auth);
  if (!(await repo.invoices.get(params.id))) return fail(404, 'الفاتورة غير موجودة');
  return json({ payments: await repo.invoices.payments(params.id) });
}
