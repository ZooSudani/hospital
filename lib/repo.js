// طبقة الوصول للبيانات (Repository) — تتبنى المستوى 3 من الحماية:
//  1) كل استعلام يمرّ عبر المنفّذ المحروس: يُرفض إن خلا من شرط tenant_id، ويُرفض أي صف من مستشفى آخر.
//  2) معرّف المستشفى (tid) يأتي من التوكن الموقّع فقط، ولا يأتي من الطلب أبدًا.
//  3) المفاتيح الأجنبية المركبة في القاعدة تمنع الربط العابر بين المستشفيات.
// لذلك كل SELECT هنا يُرجع عمود tenant_id ليفحصه الحارس، ثم نحذفه قبل الإرجاع للعميل.

import { guardedBatch, guardedExecutor } from './isolation/executors.js';

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
  const batch = guardedBatch(db);

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

      // التحصيل ذري: صف الدفعة وتحديث الفاتورة في معاملة واحدة بالشرط نفسه، فلا تُسجَّل دفعة بلا تحديث ولا العكس.
      // لا يتجاوز المتبقي ولا يعمل على فاتورة مغلقة أو ملغاة، ويُغلق الفاتورة عند اكتمال السداد.
      // رقم عملية مكرر في المستشفى يرمي خطأ UNIQUE فتُلغى المعاملة كلها.
      async collect(id, { amount, method, reference }, userId) {
        const paymentId = crypto.randomUUID();
        const cond = `WHERE tenant_id = ? AND id = ? AND status = 'open' AND paid + ? <= total`;
        const [ins, upd] = await batch([
          { sql: `INSERT INTO payments (id, tenant_id, invoice_id, amount, method, reference, created_by) SELECT ?, ?, id, ?, ?, ?, ? FROM invoices ${cond}`, args: [paymentId, tid, amount, method, reference, userId, tid, id, amount] },
          { sql: `UPDATE invoices SET paid = paid + ?, status = CASE WHEN paid + ? = total THEN 'paid' ELSE status END ${cond}`, args: [amount, amount, tid, id, amount] },
        ]);
        return ins?.meta?.changes === 1 && upd?.meta?.changes === 1 ? { id: paymentId } : null;
      },

      payments: (invoiceId) =>
        many(
          `SELECT p.id, p.tenant_id, p.amount, p.method, p.reference, p.created_at, u.name AS collector
           FROM payments p JOIN users u ON u.tenant_id = p.tenant_id AND u.id = p.created_by
           WHERE p.tenant_id = ? AND p.invoice_id = ?
           ORDER BY p.rowid DESC`,
          [tid, invoiceId]
        ),

      // لا تُلغى فاتورة عليها دفعات أو مغلقة
      async void(id) {
        const r = await write(`UPDATE invoices SET status = 'void' WHERE tenant_id = ? AND id = ? AND status = 'open' AND paid = 0`, [tid, id]);
        return r?.meta?.changes === 1;
      },
    },

    // تقارير الإدارة: أعداد ومجاميع فقط (بتوقيت الخرطوم UTC+2)، والأوقات المخزنة بالتوقيت العالمي تُزاح ساعتين
    reports: {
      async summary({ date, from, nowLocal }) {
        const day = "date(created_at, '+2 hours')";
        const [byMethod, open, issued, patients, appts, overdueCount, overdueItems, series] = await Promise.all([
          many(`SELECT method, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total, ? AS tenant_id FROM payments WHERE tenant_id = ? AND ${day} = ? GROUP BY method`, [tid, tid, date]),
          one(`SELECT COUNT(*) AS n, COALESCE(SUM(total - paid), 0) AS total, ? AS tenant_id FROM invoices WHERE tenant_id = ? AND status = 'open'`, [tid, tid]),
          one(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total, ? AS tenant_id FROM invoices WHERE tenant_id = ? AND status <> 'void' AND ${day} = ?`, [tid, tid, date]),
          one(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN ${day} = ? THEN 1 ELSE 0 END), 0) AS today, ? AS tenant_id FROM patients WHERE tenant_id = ?`, [date, tid, tid]),
          many(`SELECT status, COUNT(*) AS n, ? AS tenant_id FROM appointments WHERE tenant_id = ? AND substr(starts_at, 1, 10) = ? GROUP BY status`, [tid, tid, date]),
          one(`SELECT COUNT(*) AS n, ? AS tenant_id FROM appointments WHERE tenant_id = ? AND status = 'scheduled' AND starts_at < ?`, [tid, tid, nowLocal]),
          many(
            `SELECT a.id, a.tenant_id, a.starts_at, p.full_name AS patient_name, u.name AS doctor_name
             FROM appointments a
             JOIN patients p ON p.tenant_id = a.tenant_id AND p.id = a.patient_id
             JOIN users u ON u.tenant_id = a.tenant_id AND u.id = a.doctor_id
             WHERE a.tenant_id = ? AND a.status = 'scheduled' AND a.starts_at < ?
             ORDER BY a.starts_at DESC LIMIT 20`,
            [tid, nowLocal]
          ),
          many(`SELECT ${day} AS day, COALESCE(SUM(amount), 0) AS total, ? AS tenant_id FROM payments WHERE tenant_id = ? AND ${day} BETWEEN ? AND ? GROUP BY day ORDER BY day`, [tid, tid, from, date]),
        ]);
        return { byMethod, open, issued, patients, appts, overdueCount, overdueItems, series };
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
