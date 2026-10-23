import { fail, json } from '../../lib/http.js';
import { has } from '../../lib/permissions.js';
import { repoFor } from '../../lib/repo.js';

// سجل نشاط المستشفى (آخر 100 حدث)، لمدير المستشفى فقط
export async function onRequestGet({ env, data }) {
  if (!has(data.auth, 'audit.view')) return fail(403, 'غير مسموح');
  return json({ events: await repoFor(env, data.auth).audit.list() });
}
