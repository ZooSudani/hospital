// التحقق من مدخلات المرضى (للإنشاء والتعديل)
export function parsePatient(b, { partial = false } = {}) {
  const out = {};
  if (!partial || b.full_name !== undefined) {
    const v = String(b.full_name ?? '').trim();
    if (v.length < 3 || v.length > 120) return { error: 'الاسم من 3 إلى 120 حرفًا' };
    out.full_name = v;
  }
  if (!partial || b.phone !== undefined) out.phone = b.phone ? String(b.phone).trim().slice(0, 30) : null;
  if (!partial || b.birth_date !== undefined) {
    const v = b.birth_date ? String(b.birth_date).trim() : null;
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: 'تاريخ الميلاد بصيغة YYYY-MM-DD' };
    out.birth_date = v;
  }
  if (!partial || b.gender !== undefined) {
    const v = b.gender || null;
    if (v && !['male', 'female'].includes(v)) return { error: 'الجنس غير صحيح' };
    out.gender = v;
  }
  if (!partial || b.notes !== undefined) out.notes = b.notes ? String(b.notes).trim().slice(0, 1000) : null;
  return { value: out };
}
