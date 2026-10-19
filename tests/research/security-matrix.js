// مصفوفة الأمان: تحقن أخطاء مطوّر واقعية وتقيس هل يتسرب شيء بين المستشفيات، في كل مستوى حماية.
import { writeFileSync } from 'node:fs';
import { dbFor, seedTenant, LEVELS } from './harness.js';
import { makeData } from '../../lib/isolation/index.js';

const explain = (e) => {
  if (e.code === 'missing-tenant-filter') return 'الحارس الساكن';
  if (e.code === 'cross-tenant-row') return 'حارس النتائج';
  if (/FOREIGN KEY/i.test(String(e))) return 'مفتاح أجنبي مركب';
  return `خطأ: ${e.message}`;
};

const scenarios = [
  { id: 'S0', title: 'ضابط: كود سليم يطلب مريض مستشفى آخر', run: async (d, ctx) => {
      const r = await d.A().getPatient(ctx.pB); return { exposed: !!r };
    } },
  { id: 'S1', title: 'نسيان شرط المستشفى في جلب مريض', run: async (d, ctx) => {
      const r = await d.A({ getPatient: 'no_filter' }).getPatient(ctx.pB); return { exposed: r?.tenant_id === 'B' };
    } },
  { id: 'S2', title: 'نسيان شرط المستشفى في قائمة المواعيد', run: async (d, ctx) => {
      const rows = await d.A({ listAppointments: 'no_filter' }).listAppointments('2026-11-01', '2026-12-01');
      return { exposed: rows.some((r) => r.tenant_id === 'B') };
    } },
  { id: 'S3', title: 'خطأ أسبقية OR في البحث (الشرط موجود لكن منطقه خاطئ)', run: async (d, ctx) => {
      const rows = await d.A({ listPatients: 'precedence' }).listPatients('0912');
      return { exposed: rows.some((r) => r.tenant_id === 'B') };
    } },
  { id: 'S4', title: 'حجز موعد لمريض من مستشفى آخر', run: async (d, ctx) => {
      await d.A().createAppointment({ patient_id: ctx.pB, doctor_id: 'docA', starts_at: '2026-12-01 09:00' }); return { exposed: true };
    } },
  { id: 'S5', title: 'حجز موعد عند طبيب من مستشفى آخر', run: async (d, ctx) => {
      await d.A().createAppointment({ patient_id: ctx.pA, doctor_id: 'docB', starts_at: '2026-12-01 09:30' }); return { exposed: true };
    } },
  { id: 'S6', title: 'إرسال tenant_id مزيّف داخل بيانات الطلب', run: async (d, ctx) => {
      const q = d.A(); const id = 'forged-1';
      await q.createPatient({ id, tenant_id: 'B', file_no: '999', full_name: 'مزيّف' });
      const row = ctx.raw.prepare('SELECT tenant_id FROM patients WHERE id = ?').get(id); return { exposed: row.tenant_id === 'B' };
    } },
];

const results = {};
for (const level of Object.keys(LEVELS)) {
  const db = dbFor(level); const raw = db.raw;
  seedTenant(raw, 'A', 3, 2); seedTenant(raw, 'B', 3, 2);
  // seedTenant يستخدم t${t}، لذلك نعيد تسمية المعرّفات لتكون A وB بوضوح
  raw.exec(`PRAGMA foreign_keys = OFF`);
  for (const t of ['A', 'B']) {
    raw.prepare(`UPDATE tenants SET id = ? WHERE id = ?`).run(t, `t${t}`);
    for (const tbl of ['users', 'patients', 'appointments']) raw.prepare(`UPDATE ${tbl} SET tenant_id = ? WHERE tenant_id = ?`).run(t, `t${t}`);
  }
  raw.exec(`PRAGMA foreign_keys = ON`);
  const ctx = { raw, pA: 'pA-0', pB: 'pB-0' };
  const d = { A: (faults = {}) => makeData(level, db, 'A', faults) };
  // معرّفات الأطباء: dA وdB، نبسّطها لأسماء docA وdocB
  raw.exec(`PRAGMA foreign_keys = OFF`);
  for (const t of ['A', 'B']) {
    raw.prepare(`UPDATE users SET id = ? WHERE id = ?`).run(`doc${t}`, `d${t}`);
    raw.prepare(`UPDATE appointments SET doctor_id = ? WHERE doctor_id = ?`).run(`doc${t}`, `d${t}`);
  }
  raw.exec(`PRAGMA foreign_keys = ON`);

  results[level] = {};
  for (const s of scenarios) {
    try {
      const { exposed } = await s.run(d, ctx);
      results[level][s.id] = exposed ? { exposed: true, by: 'لا شيء' } : { exposed: false, by: 'الكود السليم' };
    } catch (e) {
      results[level][s.id] = { exposed: false, by: explain(e) };
    }
  }
}

const cell = (r) => (r.exposed ? '❌ تسرّب' : `✅ محمي (${r.by})`);
let md = `# نتائج مصفوفة الأمان\n\nكل سيناريو يحقن خطأ مطوّر واقعيًا ثم يحاول مستشفى A الوصول لبيانات مستشفى B.\n\n`;
md += `| السيناريو | ${Object.values(LEVELS).map((l) => l.name).join(' | ')} |\n| --- | --- | --- | --- |\n`;
for (const s of scenarios) md += `| ${s.id}: ${s.title} | ${Object.keys(LEVELS).map((l) => cell(results[l][s.id])).join(' | ')} |\n`;
writeFileSync(new URL('../../results/security-matrix.md', import.meta.url), md);
console.log(md);

// تحقق آلي من التوقعات
const expect = (lvl, id, exposed) => { if (results[lvl][id].exposed !== exposed) throw new Error(`نتيجة غير متوقعة: ${lvl}/${id}`); };
for (const l of ['l1', 'l2', 'l3']) { expect(l, 'S0', false); expect(l, 'S6', false); }
for (const id of ['S1', 'S2', 'S3']) { expect('l1', id, true); expect('l2', id, true); expect('l3', id, false); }
for (const id of ['S4', 'S5']) { expect('l1', id, true); expect('l2', id, false); expect('l3', id, false); }
console.log('✔ النتائج مطابقة للتوقعات النظرية');
