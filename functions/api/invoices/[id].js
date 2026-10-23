import { fail, json, readJson } from '../../../lib/http.js';
import { has } from '../../../lib/permissions.js';
import { repoFor } from '../../../lib/repo.js';

// إلغاء فاتورة (الحالة الوحيدة المسموح بها: void)، ولا تُلغى فاتورة عليها دفعات
export async function onRequestPatch({ request, params, env, data }) {
  if (!has(data.auth, 'invoices.void')) return fail(403, 'غير مسموح');
  const b = await readJson(request);
  if (!b || b.status !== 'void') return fail(400, 'الحالة غير صحيحة');
  const repo = repoFor(env, data.auth);
  if (!(await repo.invoices.get(params.id))) return fail(404, 'الفاتورة غير موجودة');
  if (!(await repo.invoices.void(params.id))) return fail(409, 'لا تُلغى فاتورة عليها دفعات أو مغلقة');
  await repo.audit.log('invoice.void', params.id.slice(0, 8));
  return json({ ok: true });
}
