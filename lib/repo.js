// طبقة الوصول للبيانات (Repository) — تتبنى المستوى 3 من الحماية:
//  1) كل استعلام يمرّ عبر المنفّذ المحروس: يُرفض إن خلا من شرط tenant_id، ويُرفض أي صف من مستشفى آخر.
//  2) معرّف المستشفى (tid) يأتي من التوكن الموقّع فقط، ولا يأتي من الطلب أبدًا.
//  3) المفاتيح الأجنبية المركبة في القاعدة تمنع الربط العابر بين المستشفيات.
// لذلك كل SELECT هنا يُرجع عمود tenant_id ليفحصه الحارس، ثم نحذفه قبل الإرجاع للعميل.

import { guardedExecutor } from './isolation/executors.js';

export function repoFor(env, auth) {
  const mode = env.ISOLATION_MODE || 'shared';
  if (!auth.tid) throw new Error('no-tenant');
  if (mode === 'shared') return sharedRepo(env.DB, auth.tid);
  throw new Error(`ISOLATION_MODE غير مدعوم: ${mode}`);
}

const strip = ({ tenant_id, ...rest }) => rest;

function sharedRepo(db, tid) {
  const exec = guardedExecutor(db, tid);
  const one = async (sql, args) => {
    const r = await exec({ kind: 'first', sql, args });
    return r ? strip(r) : null;
  };
  const many = async (sql, args) => (await exec({ kind: 'all', sql, args })).map(strip);
  const write = (sql, args) => exec({ kind: 'run', sql, args });

  return {
    staff: {
      list: () =>
        many(`SELECT id, tenant_id, name, email, role, active, created_at FROM users WHERE tenant_id = ? ORDER BY created_at`, [tid]),

      listDoctors: () =>
        many(`SELECT id, tenant_id, name FROM users WHERE tenant_id = ? AND role = 'doctor' AND active = 1 ORDER BY name`, [tid]),

      get: (id) =>
        one(`SELECT id, tenant_id, name, email, role, active FROM users WHERE tenant_id = ? AND id = ?`, [tid, id]),

      async create({ name, email, password_hash, role }) {
        const id = crypto.randomUUID();
        await write(`INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)`, [id, tid, email, name, password_hash, role]);
        return { id };
      },

      // الأعمدة المسموح بتعديلها فقط، والشرط دائمًا يتضمن tenant_id
      async update(id, fields) {
        const allowed = ['name', 'role', 'active', 'password_hash'];
        const keys = Object.keys(fields).filter((k) => allowed.includes(k));
        if (!keys.length) return;
        await write(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE tenant_id = ? AND id = ?`, [...keys.map((k) => fields[k]), tid, id]);
      },
    },

    patients: {
      list(q = '') {
        const like = `%${q}%`;
        return many(
          `SELECT id, tenant_id, file_no, full_name, phone, birth_date, gender, created_at FROM patients
           WHERE tenant_id = ? AND (full_name LIKE ? OR phone LIKE ? OR file_no LIKE ?)
           ORDER BY created_at DESC LIMIT 50`,
          [tid, like, like, like]
        );
      },

      get: (id) =>
        one(`SELECT id, tenant_id, file_no, full_name, phone, birth_date, gender, notes, created_at FROM patients WHERE tenant_id = ? AND id = ?`, [tid, id]),

      async create(p) {
        const id = crypto.randomUUID();
        const next = await one(
          `SELECT COALESCE(MAX(CAST(file_no AS INTEGER)), 0) + 1 AS n, ? AS tenant_id FROM patients WHERE tenant_id = ?`,
          [tid, tid]
        );
        const fileNo = String(next.n);
        await write(
          `INSERT INTO patients (id, tenant_id, file_no, full_name, phone, birth_date, gender, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, tid, fileNo, p.full_name, p.phone, p.birth_date, p.gender, p.notes]
        );
        return { id, file_no: fileNo };
      },
    },

    appointments: {
      async create(a) {
        const id = crypto.randomUUID();
        await write(
          `INSERT INTO appointments (id, tenant_id, patient_id, doctor_id, starts_at, reason) VALUES (?, ?, ?, ?, ?, ?)`,
          [id, tid, a.patient_id, a.doctor_id, a.starts_at, a.reason]
        );
        return { id };
      },

      // doctorId اختياري: الطبيب لا يرى إلا مواعيده
      list(date, doctorId = null) {
        const args = [tid, `${date} 00:00`, `${date} 23:59`];
        let extra = '';
        if (doctorId) { extra = ' AND a.doctor_id = ?'; args.push(doctorId); }
        return many(
          `SELECT a.id, a.tenant_id, a.patient_id, p.full_name AS patient_name, a.doctor_id, u.name AS doctor_name,
                  a.starts_at, a.status, a.reason
           FROM appointments a
           JOIN patients p ON p.tenant_id = a.tenant_id AND p.id = a.patient_id
           JOIN users u ON u.tenant_id = a.tenant_id AND u.id = a.doctor_id
           WHERE a.tenant_id = ? AND a.starts_at >= ? AND a.starts_at <= ?${extra}
           ORDER BY a.starts_at`,
          args
        );
      },

      get: (id) =>
        one(`SELECT id, tenant_id, patient_id, doctor_id, starts_at, status FROM appointments WHERE tenant_id = ? AND id = ?`, [tid, id]),

      setStatus: (id, status) =>
        write(`UPDATE appointments SET status = ? WHERE tenant_id = ? AND id = ? AND status = 'scheduled'`, [status, tid, id]),
    },
  };
}
