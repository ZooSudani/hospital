// قياس الأداء المحلي لمستويات الحماية الثلاثة على SQLite.
// تنبيه: هذه أرقام محلية تقيس كلفة القيود والحراس في التطبيق، وليست زمن D1 عبر الشبكة.
// المنهجية: 7 جولات، وفي كل جولة يُقاس كل مستوى بترتيب دوّار (لإلغاء أثر الانجراف والتسخين)،
// ونعتمد وسيط (median) الجولات بدل المتوسط لتقليل أثر القيم الشاذة.
import { writeFileSync } from 'node:fs';
import { dbFor, seedTenant, LEVELS } from './harness.js';
import { makeData } from '../../lib/isolation/index.js';

const SIZES = [{ T: 10, P: 500 }, { T: 100, P: 500 }, { T: 500, P: 200 }];
const ROUNDS = 7;
const N = 400;
const WARM = 80;
const levels = Object.keys(LEVELS);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function roundMedian(fn) {
  for (let i = 0; i < WARM; i++) await fn(i);
  const t = [];
  for (let i = 0; i < N; i++) { const s = performance.now(); await fn(WARM + i); t.push((performance.now() - s) * 1000); }
  return median(t);
}

let md = `# نتائج القياس المحلي\n\nالقيم: وسيط زمن العملية بالميكروثانية (µs)، ووسيط ${ROUNDS} جولات، و${N} تكرارًا في كل جولة. SQLite محلية، وليست D1 عبر الشبكة.\n`;

for (const { T, P } of SIZES) {
  const ctx = {};
  for (const level of levels) {
    const db = dbFor(level);
    db.raw.exec('BEGIN');
    for (let t = 0; t < T; t++) seedTenant(db.raw, t, P, Math.floor(P / 5));
    db.raw.exec('COMMIT');
    ctx[level] = { d: makeData(level, db, 't0'), c: 0 };
  }
  const ops = {
    'جلب مريض': (x) => (i) => x.d.getPatient(`p0-${i % P}`),
    'بحث مرضى': (x) => (i) => x.d.listPatients(`0912000${i % 10}`),
    'قائمة مواعيد': (x) => (i) => x.d.listAppointments(`2026-11-${String(1 + (i % 20)).padStart(2, '0')}`, `2026-11-${String(2 + (i % 20)).padStart(2, '0')}`),
    'إضافة مريض': (x) => () => x.d.createPatient({ file_no: `n${x.c++}`, full_name: 'اختبار', phone: '0900' }),
    'إضافة موعد': (x) => (i) => x.d.createAppointment({ patient_id: `p0-${i % P}`, doctor_id: 'd0', starts_at: `2027-01-01 ${String(i % 24).padStart(2, '0')}:00` }),
  };
  const samples = {};
  for (const op of Object.keys(ops)) samples[op] = { l1: [], l2: [], l3: [] };
  for (let r = 0; r < ROUNDS; r++) {
    const order = [...levels.slice(r % 3), ...levels.slice(0, r % 3)];
    for (const op of Object.keys(ops)) for (const level of order) samples[op][level].push(await roundMedian(ops[op](ctx[level])));
  }
  md += `\n## ${T} مستشفى × ${P} مريض (إجمالي ${T * P} مريض)\n\n| العملية | L1 | L2 | L3 | L2 مقابل L1 | L3 مقابل L1 |\n| --- | --- | --- | --- | --- | --- |\n`;
  for (const op of Object.keys(ops)) {
    const [a, b, c] = levels.map((l) => median(samples[op][l]));
    const d = (x) => `${x >= a ? '+' : ''}${(((x - a) / a) * 100).toFixed(0)}%`;
    md += `| ${op} | ${a.toFixed(1)} | ${b.toFixed(1)} | ${c.toFixed(1)} | ${d(b)} | ${d(c)} |\n`;
  }
}
writeFileSync(new URL('../../results/benchmark.md', import.meta.url), md);
console.log(md);
