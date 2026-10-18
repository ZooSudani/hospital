// طبقة الوصول للبيانات (Repository).
// كل الاستعلامات تأخذ معرّف المستشفى (tid) من التوكن الموقّع فقط، ولا تأخذه من الطلب أبدًا.
// الواجهة واحدة لنمطي العزل، فيتغير النمط بتبديل هذه الطبقة وحدها، وتبقى المقارنة عادلة.

export function repoFor(env, auth) {
  const mode = env.ISOLATION_MODE || 'shared';
  if (!auth.tid) throw new Error('no-tenant');
  if (mode === 'shared') return sharedRepo(env.DB, auth.tid);
  throw new Error(`ISOLATION_MODE غير مدعوم بعد: ${mode}`);
}

function sharedRepo(db, tid) {
  return {
    staff: {
      async list() {
        const { results } = await db
          .prepare(`SELECT id, name, email, role, active, created_at FROM users WHERE tenant_id = ? ORDER BY created_at`)
          .bind(tid)
          .all();
        return results;
      },

      async get(id) {
        return db
          .prepare(`SELECT id, name, email, role, active FROM users WHERE tenant_id = ? AND id = ?`)
          .bind(tid, id)
          .first();
      },

      async create({ name, email, password_hash, role }) {
        const id = crypto.randomUUID();
        await db
          .prepare(`INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(id, tid, email, name, password_hash, role)
          .run();
        return { id };
      },

      // الأعمدة المسموح بتعديلها فقط، والشرط دائمًا يتضمن tenant_id
      async update(id, fields) {
        const allowed = ['name', 'role', 'active', 'password_hash'];
        const keys = Object.keys(fields).filter((k) => allowed.includes(k));
        if (!keys.length) return;
        const sets = keys.map((k) => `${k} = ?`).join(', ');
        await db
          .prepare(`UPDATE users SET ${sets} WHERE tenant_id = ? AND id = ?`)
          .bind(...keys.map((k) => fields[k]), tid, id)
          .run();
      },
    },

    patients: {
      async list(q = '') {
        const like = `%${q}%`;
        const { results } = await db
          .prepare(
            `SELECT id, file_no, full_name, phone, birth_date, gender, created_at
             FROM patients
             WHERE tenant_id = ? AND (? = '' OR full_name LIKE ? OR phone LIKE ? OR file_no LIKE ?)
             ORDER BY created_at DESC LIMIT 50`
          )
          .bind(tid, q, like, like, like)
          .all();
        return results;
      },

      async get(id) {
        return db
          .prepare(
            `SELECT id, file_no, full_name, phone, birth_date, gender, notes, created_at
             FROM patients WHERE tenant_id = ? AND id = ?`
          )
          .bind(tid, id)
          .first();
      },

      async create(p) {
        const id = crypto.randomUUID();
        const next = await db
          .prepare(`SELECT COALESCE(MAX(CAST(file_no AS INTEGER)), 0) + 1 AS n FROM patients WHERE tenant_id = ?`)
          .bind(tid)
          .first();
        const fileNo = String(next.n);
        await db
          .prepare(
            `INSERT INTO patients (id, tenant_id, file_no, full_name, phone, birth_date, gender, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(id, tid, fileNo, p.full_name, p.phone, p.birth_date, p.gender, p.notes)
          .run();
        return { id, file_no: fileNo };
      },
    },
  };
}
