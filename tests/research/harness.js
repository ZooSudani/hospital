import { readFileSync } from 'node:fs';
import { makeDb } from '../d1-shim.js';

const SCHEMA = readFileSync(new URL('../../schema/shared.sql', import.meta.url), 'utf8');

// المستوى 1: نفس المخطط لكن بمفاتيح أجنبية عادية على id فقط (بلا tenant_id)،
// أي أن القاعدة لا تتحقق أن المرجع من نفس المستشفى.
const LEVEL1_SCHEMA = SCHEMA.replace(
  /FOREIGN KEY \(tenant_id, (\w+)\)\s+REFERENCES (\w+) \(tenant_id, id\)/g,
  'FOREIGN KEY ($1) REFERENCES $2 (id)'
);

export const LEVELS = {
  l1: { name: 'المستوى 1: فلتر في الكود', schema: LEVEL1_SCHEMA },
  l2: { name: 'المستوى 2: + مفاتيح أجنبية مركبة', schema: SCHEMA },
  l3: { name: 'المستوى 3: + حارس مركزي', schema: SCHEMA },
};

export const dbFor = (level) => makeDb(LEVELS[level].schema);

export function seedTenant(raw, t, patients, appts = 0) {
  raw.prepare(`INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)`).run(`t${t}`, `مستشفى ${t}`, `h${t}`);
  raw.prepare(`INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, 'x', 'doctor')`)
    .run(`d${t}`, `t${t}`, `d${t}@x.com`, `طبيب ${t}`);
  const ins = raw.prepare(`INSERT INTO patients (id, tenant_id, file_no, full_name, phone) VALUES (?, ?, ?, ?, ?)`);
  for (let i = 0; i < patients; i++) ins.run(`p${t}-${i}`, `t${t}`, String(i + 1), `مريض ${i} م${t}`, `0912${String(t).padStart(3, '0')}${String(i).padStart(3, '0')}`);
  const ia = raw.prepare(`INSERT INTO appointments (id, tenant_id, patient_id, doctor_id, starts_at) VALUES (?, ?, ?, ?, ?)`);
  for (let i = 0; i < appts; i++) ia.run(`a${t}-${i}`, `t${t}`, `p${t}-${i % Math.max(patients, 1)}`, `d${t}`, `2026-11-${String(1 + (i % 28)).padStart(2, '0')} 10:00`);
}
