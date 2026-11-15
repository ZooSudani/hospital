// تحليل نص البحث عن المرضى.
// المشكلة التي يحلها: البحث عن «3» كان يطابق أي اسم أو هاتف أو ملف يحتوي الرقم، فتغرق نتيجة الملف رقم 3 بين عشرات الهواتف.
// القواعد الآن:
//   - الأرقام الهندية والفارسية (٠-٩ و۰-۹) تُحوَّل إلى أرقام لاتينية.
//   - «ملف 12» و«رقم الملف 12» و«#12» تُفهم كرقم ملف.
//   - رقم قصير (حتى 3 خانات) = رقم ملف بالضبط، ولا يُبحث به في الهواتف.
//   - رقم أطول = رقم ملف بالضبط أو جزء من الهاتف، ويتقدم الملف المطابق بالضبط.
//   - «+249912345678» و«249912345678» تُحوَّل إلى الصيغة المحلية 0912345678.
//   - أي نص آخر = بحث في الاسم والهاتف.
const INDIC = '٠١٢٣٤٥٦٧٨٩', PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeDigits(s) {
  return String(s ?? '').replace(/[٠-٩۰-۹]/g, (c) => String(INDIC.includes(c) ? INDIC.indexOf(c) : PERSIAN.indexOf(c)));
}

export function parsePatientQuery(q) {
  let t = normalizeDigits(q).trim().slice(0, 60);
  if (!t) return { kind: 'recent' };
  t = t.replace(/^(رقم\s*)?(الملف|ملف)\s*[:：]?\s*/i, '').replace(/^#\s*/, '').replace(/^file\s*[:#]?\s*/i, '').trim();
  if (/^[+\d\s\-()]+$/.test(t) && /\d/.test(t)) {
    let digits = t.replace(/\D/g, '');
    if (digits.startsWith('249') && digits.length >= 11) digits = '0' + digits.slice(3); // رمز السودان الدولي
    return { kind: 'number', digits };
  }
  return { kind: 'text', text: t };
}

const escapeLike = (v) => String(v).replace(/[\\%_]/g, '\\$&');

// يبني شرط WHERE وترتيبه (دون tenant_id الذي تضيفه طبقة البيانات)
export function patientSearchClause(q) {
  const p = parsePatientQuery(q);
  if (p.kind === 'recent') return { cond: '1 = 1', args: [], order: 'created_at DESC', orderArgs: [] };
  if (p.kind === 'number') {
    if (p.digits.length <= 3) return { cond: 'file_no = ?', args: [p.digits], order: 'created_at DESC', orderArgs: [] };
    return {
      cond: "(file_no = ? OR phone LIKE ? ESCAPE '\\')",
      args: [p.digits, `%${escapeLike(p.digits)}%`],
      order: '(file_no = ?) DESC, created_at DESC',
      orderArgs: [p.digits],
    };
  }
  const like = `%${escapeLike(p.text)}%`;
  return { cond: "(full_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')", args: [like, like], order: 'created_at DESC', orderArgs: [] };
}
