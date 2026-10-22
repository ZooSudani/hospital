import { can, fail, json } from '../../lib/http.js';
import { repoFor } from '../../lib/repo.js';

// سجل نشاط المستشفى (آخر 100 حدث)، لمدير المستشفى فقط
export async function onRequestGet({ env, data }) {
  if (!can(data.auth, 'admin')) return fail(403, 'لمدير المستشفى فقط');
  return json({ events: await repoFor(env, data.auth).audit.list() });
}
