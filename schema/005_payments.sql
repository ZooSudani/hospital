-- شغّل هذا الملف في D1 Console قبل رفع تحديث الدفعات والتقارير (مقاطعه مستقلة).
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
