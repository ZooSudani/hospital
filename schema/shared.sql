-- نمط العزل 1: جداول مشتركة بعمود tenant_id
-- شغّل هذا الملف مرة واحدة في D1 Console.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- tenant_id = NULL يعني مدير المنصة (platform_admin)
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT REFERENCES tenants(id),
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('platform_admin','admin','doctor','reception','accountant')),
  active        INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,
  perm_overrides TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, email),
  UNIQUE (tenant_id, id),
  CHECK ((role = 'platform_admin' AND tenant_id IS NULL) OR (role <> 'platform_admin' AND tenant_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS patients (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  file_no     TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  phone       TEXT,
  birth_date  TEXT,
  gender      TEXT CHECK (gender IN ('male','female')),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, file_no),
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_patients_tenant_name ON patients (tenant_id, full_name);
CREATE INDEX IF NOT EXISTS idx_patients_tenant_phone ON patients (tenant_id, phone);

-- المفاتيح الأجنبية المركبة (tenant_id, id): تمنع على مستوى قاعدة البيانات
-- ربط سجل في مستشفى بسجل في مستشفى آخر.
CREATE TABLE IF NOT EXISTS appointments (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  patient_id  TEXT NOT NULL,
  doctor_id   TEXT NOT NULL,
  starts_at   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','done','cancelled','no_show')),
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id)  REFERENCES users (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_appt_tenant_time ON appointments (tenant_id, starts_at);

-- يمنع حجز موعدين محجوزين لنفس الطبيب في الوقت نفسه (وإلغاء الموعد يحرر الوقت)
CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_slot ON appointments (tenant_id, doctor_id, starts_at) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS visits (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  patient_id     TEXT NOT NULL,
  doctor_id      TEXT NOT NULL,
  appointment_id TEXT,
  diagnosis      TEXT,
  notes          TEXT,
  prescription   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)     REFERENCES patients (tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id)      REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_visits_tenant_patient ON visits (tenant_id, patient_id, created_at);

CREATE TABLE IF NOT EXISTS invoices (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  patient_id  TEXT NOT NULL,
  visit_id    TEXT,
  total       INTEGER NOT NULL CHECK (total >= 0),
  paid        INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','void')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id),
  FOREIGN KEY (tenant_id, visit_id)   REFERENCES visits (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_patient ON invoices (tenant_id, patient_id);

-- محاولات الدخول الفاشلة (لتحديد التخمين)
CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,
  fails        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- سجل النشاط (بلا مفاتيح أجنبية عمدًا، ليبقى التاريخ محفوظًا مهما تغيّرت السجلات)
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  TEXT,
  user_id    TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log (tenant_id, id);

-- سجل الدفعات: كل تحصيل صف مستقل بطريقة الدفع ورقم العملية (إيصال قابل للتدقيق)
CREATE TABLE IF NOT EXISTS payments (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  invoice_id TEXT NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  method     TEXT NOT NULL CHECK (method IN ('cash','bankak','other')),
  reference  TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_time ON payments (tenant_id, created_at);
-- رقم العملية لا يُسجَّل مرتين في المستشفى نفسه (يمنع تسجيل التحويل الواحد دفعتين)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_ref ON payments (tenant_id, method, reference) WHERE reference IS NOT NULL;
