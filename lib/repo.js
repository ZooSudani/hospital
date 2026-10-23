// طبقة الوصول للبيانات (Repository) — تتبنى المستوى 3 من الحماية:
//  1) كل استعلام يمرّ عبر المنفّذ المحروس: يُرفض إن خلا من شرط tenant_id، ويُرفض أي صف من مستشفى آخر.
//  2) معرّف المستشفى (tid) يأتي من التوكن الموقّع فقط، ولا يأتي من الطلب أبدًا.
//  3) المفاتيح الأجنبية المركبة في القاعدة تمنع الربط العابر بين المستشفيات.
// لذلك كل SELECT هنا يُرجع عمود tenant_id ليفحصه الحارس، ثم نحذفه قبل الإرجاع للعميل.

import { guardedExecutor } from './isolation/executors.js';

export function repoFor(env, auth) {
  const mode = env.ISOLATION_MODE || 'shared';
  if (!auth.tid) throw new Error('no-tenant');
  if (mode === 'shared') return sharedRepo(env.DB, auth.tid, auth);
  throw new Error(`ISOLATION_MODE غير مدعوم: ${mode}`);
}

const strip = ({ tenant_id, ...rest }) => rest;

function sharedRepo(db, tid, auth) {
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
        many(`SELECT id, tenant_id, name, email, role, active, created_at, CASE WHEN perm_overrides IS NULL THEN 0 ELSE 1 END AS custom FROM users WHERE tenant_id = ? ORDER BY created_at`, [tid]),

      listDoctors: () =>
        many(`SELECT id, tenant_id, name FROM users WHERE tenant_id = ? AND role = 'doctor' AND active = 1 ORDER BY name`, [tid]),

      get: (id) =>
        one(`SELECT id, tenant_id, name, email, role, active FROM users WHERE tenant_id = ? AND id = ?`, [tid, id]),

      getAccess: (id) =>
        one(`SELECT id, tenant_id, name, role, active, perm_overrides FROM users WHERE tenant_id = ? AND id = ?`, [tid, id]),

      setOverrides: (id, json) =>
        write(`UPDATE users SET perm_overrides = ? WHERE tenant_id = ? AND id = ?`, [json, tid, id]),

      async create({ name, email, password_hash, role }) {
        const id = crypto.randomUUID();
        await write(`INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)`, [id, tid, email, name, password_hash, role]);
        return { id };
      },

      // الأعمدة المسموح بتعديلها فقط، والشرط دائمًا يتضمن tenant_id
      async update(id, fields) {
        const allowed = ['name', 'role', 'active', 'password_hash', 'perm_overrides'];
        const keys = Object.keys(fields).filter((k) => allowed.includes(k));
        if (!keys.length) return;
        // تغيير كلمة المرور يرفع token_version فتسقط كل الجلسات القديمة للمستخدم فورًا
        const bump = keys.includes('password_hash') ? ', token_version = token_version + 1' : '';
        await write(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')}${bump} WHERE tenant_id = ? AND id = ?`, [...keys.map((k) => fields[k]), tid, id]);
      },
    },

    patients: {
      list(q = '') {
        const like = `%${String(q).replace(/[\\%_]/g, '\\$&')}%`; // محارف البحث الخاصة تُعامل كنص عادي
        return many(
          `SELECT id, tenant_id, file_no, full_name, phone, birth_date, gender, created_at FROM patients
           WHERE tenant_id = ? AND (full_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR file_no LIKE ? ESCAPE '\\')
           ORDER BY created_at DESC LIMIT 50`,
          [tid, like, like, like]
        );
      },

      get: (id) =>
        one(`SELECT id, tenant_id, file_no, full_name, phone, birth_date, gender, notes, created_at FROM patients WHERE tenant_id = ? AND id = ?`, [tid, id]),

      async update(id, fields) {
        const allowed = ['full_name', 'phone', 'birth_date', 'gender', 'notes'];
        const keys = Object.keys(fields).filter((k) => allowed.includes(k));
        if (!keys.length) return;
        await write(`UPDATE patients SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE tenant_id = ? AND id = ?`, [...keys.map((k) => fields[k]), tid, id]);
      },

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

    // السجل الطبي: إضافة فقط (لا تعديل ولا حذف)، فأي تصحيح يُسجَّل كزيارة جديدة
    visits: {
      list: (patientId) =>
        many(
          `SELECT v.id, v.tenant_id, v.doctor_id, u.name AS doctor_name, v.diagnosis, v.notes, v.prescription, v.created_at
           FROM visits v JOIN users u ON u.tenant_id = v.tenant_id AND u.id = v.doctor_id
           WHERE v.tenant_id = ? AND v.patient_id = ?
           ORDER BY v.rowid DESC LIMIT 100`,
          [tid, patientId]
        ),

      async create(v) {
        const id = crypto.randomUUID();
        await write(
          `INSERT INTO visits (id, tenant_id, patient_id, doctor_id, appointment_id, diagnosis, notes, prescription) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, tid, v.patient_id, v.doctor_id, v.appointment_id, v.diagnosis, v.notes, v.prescription]
        );
        return { id };
      },
    },

    invoices: {
      list(patientId = null) {
        const args = [tid];
        let extra = '';
        if (patientId) { extra = ' AND i.patient_id = ?'; args.push(patientId); }
        return many(
          `SELECT i.id, i.tenant_id, i.patient_id, p.full_name AS patient_name, i.total, i.paid, i.status, i.created_at
           FROM invoices i JOIN patients p ON p.tenant_id = i.tenant_id AND p.id = i.patient_id
           WHERE i.tenant_id = ?${extra}
           ORDER BY i.rowid DESC LIMIT 100`,
          args
        );
      },

      get: (id) => one(`SELECT id, tenant_id, patient_id, total, paid, status FROM invoices WHERE tenant_id = ? AND id = ?`, [tid, id]),

      async create({ patient_id, total }) {
        const id = crypto.randomUUID();
        await write(`INSERT INTO invoices (id, tenant_id, patient_id, total) VALUES (?, ?, ?, ?)`, [id, tid, patient_id, total]);
        return { id };
      },

      // التحصيل ذري: لا يتجاوز المتبقي ولا يعمل على فاتورة مغلقة أو ملغاة، ويُغلق الفاتورة عند اكتمال السداد
      async collect(id, amount) {
        const r = await write(
          `UPDATE invoices SET paid = paid + ?, status = CASE WHEN paid + ? = total THEN 'paid' ELSE status END
           WHERE tenant_id = ? AND id = ? AND status = 'open' AND paid + ? <= total`,
          [amount, amount, tid, id, amount]
        );
        return r?.meta?.changes === 1;
      },

      // لا تُلغى فاتورة عليها دفعات أو مغلقة
      async void(id) {
        const r = await write(`UPDATE invoices SET status = 'void' WHERE tenant_id = ? AND id = ? AND status = 'open' AND paid = 0`, [tid, id]);
        return r?.meta?.changes === 1;
      },
    },

    audit: {
      // محاولة بأفضل جهد: فشل التسجيل لا يعطّل العملية نفسها
      async log(action, target = null, detail = null) {
        try {
          await write(
            `INSERT INTO audit_log (tenant_id, user_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)`,
            [tid, auth.uid, action, target, detail ? String(detail).slice(0, 200) : null, auth.ip || null]
          );
        } catch (e) {
          console.error('audit failed', e?.message || e);
        }
      },

      list: () =>
        many(
          `SELECT a.id, a.tenant_id, a.action, a.target, a.detail, a.ip, a.created_at, u.name AS user_name
           FROM audit_log a
           LEFT JOIN users u ON u.tenant_id = a.tenant_id AND u.id = a.user_id
           WHERE a.tenant_id = ?
           ORDER BY a.id DESC LIMIT 100`,
          [tid]
        ),
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
