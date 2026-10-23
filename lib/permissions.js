// نظام الصلاحيات: المصدر الوحيد للحقيقة، يقرؤه الخادم وتعرضه الواجهة (فلا يتكرر في مكانين).
//
// المبادئ:
//  1) أقل صلاحية ممكنة لكل دور (Least Privilege): كل دور يملك ما يحتاجه عمله فقط.
//  2) فصل المهام: من يصدر الفاتورة ويحصّلها (المحاسب) غير من يراقب (المدير)، ومن يكتب السجل الطبي (الطبيب) غير من يدير الاستقبال.
//  3) الخصوصية: السجل الطبي للأطباء فقط افتراضيًا، وكل قراءة له تُسجَّل في سجل النشاط.
//  4) تخصيص لكل شخص: مدير المستشفى يمنح موظفًا صلاحية إضافية أو يسحب صلاحية، والسحب (deny) يغلب المنح دائمًا.
//  5) الصلاحيات «الحساسة» (إدارة الموظفين، سجل النشاط) لا يمنحها إلا مدير المنصة.

export const CATALOG = [
  { key: 'patients.read', group: 'المرضى', label: 'عرض قائمة المرضى' },
  { key: 'patients.create', group: 'المرضى', label: 'تسجيل مريض جديد' },
  { key: 'patients.update', group: 'المرضى', label: 'تعديل بيانات المريض' },
  { key: 'appointments.read', group: 'المواعيد', label: 'عرض المواعيد' },
  { key: 'appointments.all', group: 'المواعيد', label: 'التعامل مع مواعيد كل الأطباء (لا مواعيده فقط)' },
  { key: 'appointments.book', group: 'المواعيد', label: 'حجز موعد' },
  { key: 'appointments.cancel', group: 'المواعيد', label: 'إلغاء موعد' },
  { key: 'appointments.complete', group: 'المواعيد', label: 'تسجيل حضور المريض أو غيابه' },
  { key: 'visits.read', group: 'السجل الطبي', label: 'قراءة السجل الطبي' },
  { key: 'visits.write', group: 'السجل الطبي', label: 'تسجيل زيارة طبية (تشخيص ووصفة)' },
  { key: 'invoices.read', group: 'الفواتير', label: 'عرض الفواتير' },
  { key: 'invoices.create', group: 'الفواتير', label: 'إصدار فاتورة' },
  { key: 'invoices.collect', group: 'الفواتير', label: 'تحصيل دفعة' },
  { key: 'invoices.void', group: 'الفواتير', label: 'إلغاء فاتورة' },
  { key: 'staff.manage', group: 'الإدارة', label: 'إدارة الموظفين', restricted: true },
  { key: 'audit.view', group: 'الإدارة', label: 'عرض سجل النشاط', restricted: true },
];

export const KEYS = new Set(CATALOG.map((p) => p.key));
export const RESTRICTED = new Set(CATALOG.filter((p) => p.restricted).map((p) => p.key));

// الصلاحيات الافتراضية لكل دور
export const ROLE_DEFAULTS = {
  // المدير: يدير ويراقب، لكنه لا يقرأ السجل الطبي ولا يحصّل الأموال (فصل مهام)
  admin: [
    'patients.read', 'patients.create', 'patients.update',
    'appointments.read', 'appointments.all', 'appointments.book', 'appointments.cancel', 'appointments.complete',
    'invoices.read', 'staff.manage', 'audit.view',
  ],
  // الاستقبال: المرضى والمواعيد، بلا أي وصول للسجل الطبي أو المال
  reception: [
    'patients.read', 'patients.create', 'patients.update',
    'appointments.read', 'appointments.all', 'appointments.book', 'appointments.cancel', 'appointments.complete',
  ],
  // الطبيب: مواعيده هو، والسجل الطبي، وقراءة قائمة المرضى
  doctor: ['patients.read', 'appointments.read', 'appointments.complete', 'visits.read', 'visits.write'],
  // المحاسب: الفواتير والتحصيل، وقراءة المرضى لإصدار الفاتورة
  accountant: ['patients.read', 'invoices.read', 'invoices.create', 'invoices.collect', 'invoices.void'],
};

// تخصيصات الشخص مخزنة نصًا (JSON): { grant: [...], deny: [...] }
export function parseOverrides(text) {
  try {
    const v = text ? JSON.parse(text) : null;
    const clean = (a) => (Array.isArray(a) ? a.filter((k) => KEYS.has(k)) : []);
    return { grant: clean(v?.grant), deny: clean(v?.deny) };
  } catch {
    return { grant: [], deny: [] };
  }
}

// المحصّلة: افتراضيات الدور + المنح - السحب (السحب يغلب دائمًا)
export function effectivePermissions(role, overrides) {
  const set = new Set(ROLE_DEFAULTS[role] || []);
  for (const k of overrides?.grant || []) if (KEYS.has(k)) set.add(k);
  for (const k of overrides?.deny || []) set.delete(k);
  return [...set];
}

export const has = (auth, perm) => !!auth?.perms?.includes(perm);

// يتحقق من تخصيصات مُرسلة ويُرجعها مختصرة (الفرق عن افتراضيات الدور فقط)
export function normalizeOverrides(body, role, { callerIsPlatform }) {
  const defaults = new Set(ROLE_DEFAULTS[role] || []);
  const list = (v) => (v === undefined ? [] : v);
  const grant = list(body?.grant);
  const deny = list(body?.deny);
  if (!Array.isArray(grant) || !Array.isArray(deny)) return { error: 'الصيغة غير صحيحة' };
  for (const k of [...grant, ...deny]) if (typeof k !== 'string' || !KEYS.has(k)) return { error: 'صلاحية غير معروفة: ' + String(k).slice(0, 40) };
  if (grant.some((k) => deny.includes(k))) return { error: 'لا يمكن منح صلاحية وسحبها معًا' };
  if (!callerIsPlatform && grant.some((k) => RESTRICTED.has(k))) return { error: 'هذه الصلاحية لا يمنحها إلا مدير المنصة' };
  return {
    value: {
      grant: [...new Set(grant)].filter((k) => !defaults.has(k)),
      deny: [...new Set(deny)].filter((k) => defaults.has(k)),
    },
  };
}

// ما تعرضه الواجهة في محرّر الصلاحيات
export function permissionsInfo(role, overridesText, { callerIsPlatform }) {
  const overrides = parseOverrides(overridesText);
  return {
    role,
    catalog: CATALOG,
    defaults: ROLE_DEFAULTS[role] || [],
    overrides,
    effective: effectivePermissions(role, overrides),
    grantable: CATALOG.filter((p) => callerIsPlatform || !p.restricted).map((p) => p.key),
  };
}
