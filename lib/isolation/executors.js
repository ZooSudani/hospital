// منفّذا الاستعلامات:
//  - direct : ينفّذ الاستعلام كما هو (مستويان 1 و2)
//  - guarded: المستوى 3، يضيف حارسين على كل استعلام:
//      1) حارس ساكن: يرفض أي استعلام بلا شرط tenant_id قبل تنفيذه
//      2) حارس النتائج: يرفض أي صف يعود من مستشفى آخر، حتى لو كان الشرط موجودًا لكنه خاطئ المنطق

export class IsolationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function run(db, q) {
  const st = db.prepare(q.sql).bind(...q.args);
  if (q.kind === 'all') return (await st.all()).results;
  if (q.kind === 'first') return st.first();
  return st.run();
}

export const directExecutor = (db) => (q) => run(db, q);

const FILTER = /\btenant_id\s*=\s*\?/i;
const INSERT_HAS_TENANT = /^\s*insert\s+into\s+\w+\s*\([^)]*\btenant_id\b/i;

// الحارس الساكن: يرفض أي استعلام بلا tenant_id قبل تنفيذه
function assertScoped(sql) {
  const isInsert = /^\s*insert\b/i.test(sql);
  if (isInsert ? !INSERT_HAS_TENANT.test(sql) : !FILTER.test(sql)) {
    throw new IsolationError('missing-tenant-filter', 'الاستعلام لا يحتوي شرط tenant_id');
  }
}

// عدة عبارات في معاملة واحدة (كلها تنجح أو كلها تُلغى)، وكل عبارة تمرّ بالحارس الساكن
export const guardedBatch = (db) => async (queries) => {
  for (const q of queries) assertScoped(q.sql);
  return db.batch(queries.map((q) => db.prepare(q.sql).bind(...q.args)));
};

export const guardedExecutor = (db, tid) => async (q) => {
  assertScoped(q.sql);
  const res = await run(db, q);
  const rows = q.kind === 'all' ? res : q.kind === 'first' ? (res ? [res] : []) : [];
  for (const r of rows) {
    if (r.tenant_id === undefined) throw new IsolationError('guard-blind', 'الاستعلام لا يُرجع tenant_id فلا يمكن فحصه');
    if (r.tenant_id !== tid) throw new IsolationError('cross-tenant-row', 'عاد صف من مستشفى آخر');
  }
  return res;
};
