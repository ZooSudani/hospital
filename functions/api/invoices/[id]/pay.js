import { fail, json, readJson } from '../../../../lib/http.js';
import { has } from '../../../../lib/permissions.js';
import { repoFor } from '../../../../lib/repo.js';

const METHODS = ['cash', 'bankak', 'other'];
const REF = /^[A-Za-z0-9_\-/]{3,40}$/;

// تحصيل دفعة على فاتورة مفتوحة: المبلغ وطريقة الدفع (نقدًا أو بنكك أو أخرى) ورقم العملية.
// بنكك يتطلب رقم عملية، ورقم العملية لا يتكرر في المستشفى، والمجموع لا يتجاوز قيمة الفاتورة.
export async function onRequestPost({ request, params, env, data }) {
  if (!has(data.auth, 'invoices.collect')) return fail(403, 'غير مسموح');
  const b = await readJson(request);
  const amount = Number(b?.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000) return fail(400, 'المبلغ رقم صحيح موجب');
  const method = String(b?.method || '');
  if (!METHODS.includes(method)) return fail(400, 'اختر طريقة الدفع: نقدًا أو بنكك أو أخرى');

  let reference = b?.reference ? String(b.reference).replace(/\s+/g, '') : '';
  if (method === 'bankak' && !reference) return fail(400, 'رقم عملية بنكك مطلوب');
  if (reference && !REF.test(reference)) return fail(400, 'رقم العملية من 3 إلى 40 حرفًا أو رقمًا (دون رموز)');
  if (method === 'cash') reference = ''; // النقد بلا رقم عملية
  reference = reference || null;

  const repo = repoFor(env, data.auth);
  if (!(await repo.invoices.get(params.id))) return fail(404, 'الفاتورة غير موجودة');
  let done;
  try {
    done = await repo.invoices.collect(params.id, { amount, method, reference }, data.auth.uid);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail(409, 'رقم العملية هذا مسجّل من قبل في المستشفى');
    throw e;
  }
  if (!done) return fail(409, 'المبلغ يتجاوز المتبقي، أو الفاتورة مغلقة أو ملغاة');
  await repo.audit.log('invoice.pay', params.id.slice(0, 8), `${method}:${amount}`);
  return json({ ok: true, payment_id: done.id });
}
