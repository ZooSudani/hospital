// فهرس الاستعلامات للتجارب البحثية.
// كل استعلام يُبنى هنا، ويمكن حقن "خطأ مطوّر" فيه (faults) لاختبار قدرة كل مستوى حماية على احتوائه.
//   no_filter  :  نسيان شرط tenant_id
//   precedence : شرط OR بلا أقواس يتجاوز شرط المستشفى (خطأ شائع)

export function queries(tid, faults = {}) {
  return {
    listPatients(q = '') {
      const like = `%${q}%`;
      if (faults.listPatients === 'precedence') {
        return {
          kind: 'all',
          sql: `SELECT id, tenant_id, file_no, full_name, phone FROM patients
                WHERE tenant_id = ? AND full_name LIKE ? OR phone LIKE ?
                ORDER BY created_at DESC LIMIT 50`,
          args: [tid, like, like],
        };
      }
      return {
        kind: 'all',
        sql: `SELECT id, tenant_id, file_no, full_name, phone FROM patients
              WHERE tenant_id = ? AND (full_name LIKE ? OR phone LIKE ? OR file_no LIKE ?)
              ORDER BY created_at DESC LIMIT 50`,
        args: [tid, like, like, like],
      };
    },

    getPatient(id) {
      if (faults.getPatient === 'no_filter') {
        return { kind: 'first', sql: `SELECT id, tenant_id, file_no, full_name, phone FROM patients WHERE id = ?`, args: [id] };
      }
      return {
        kind: 'first',
        sql: `SELECT id, tenant_id, file_no, full_name, phone FROM patients WHERE tenant_id = ? AND id = ?`,
        args: [tid, id],
      };
    },

    createPatient(p) {
      const id = p.id || crypto.randomUUID();
      // tenant_id يأتي من tid فقط، وأي قيمة مرسلة في p تُتجاهل
      return {
        kind: 'run',
        sql: `INSERT INTO patients (id, tenant_id, file_no, full_name, phone) VALUES (?, ?, ?, ?, ?)`,
        args: [id, tid, p.file_no, p.full_name, p.phone ?? null],
        id,
      };
    },

    createAppointment(a) {
      const id = a.id || crypto.randomUUID();
      return {
        kind: 'run',
        sql: `INSERT INTO appointments (id, tenant_id, patient_id, doctor_id, starts_at, reason) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [id, tid, a.patient_id, a.doctor_id, a.starts_at, a.reason ?? null],
        id,
      };
    },

    listAppointments(from, to) {
      if (faults.listAppointments === 'no_filter') {
        return {
          kind: 'all',
          sql: `SELECT id, tenant_id, patient_id, doctor_id, starts_at, status FROM appointments
                WHERE starts_at >= ? AND starts_at < ? ORDER BY starts_at`,
          args: [from, to],
        };
      }
      return {
        kind: 'all',
        sql: `SELECT id, tenant_id, patient_id, doctor_id, starts_at, status FROM appointments
              WHERE tenant_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at`,
        args: [tid, from, to],
      };
    },
  };
}
