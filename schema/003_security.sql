-- شغّل هذا الملف مرة واحدة فقط في D1 Console قبل رفع تحديث الأمان.
-- (السطر الأول يفشل إن شُغّل مرتين لأن العمود موجود، وهذا طبيعي)
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,
  fails        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

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
