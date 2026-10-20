// سجل النشاط للأحداث التي تسبق معرفة المستخدم أو تخص المنصة (الدخول، إنشاء مستشفى).
// أحداث المستشفى نفسها تُسجَّل عبر repo.audit.log. التسجيل محاولة بأفضل جهد ولا يعطّل الطلب.
export async function auditRaw(db, e) {
  try {
    await db
      .prepare(`INSERT INTO audit_log (tenant_id, user_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(e.tenant_id ?? null, e.user_id ?? null, e.action, e.target ?? null, e.detail ? String(e.detail).slice(0, 200) : null, e.ip ?? null)
      .run();
  } catch (err) {
    console.error('audit failed', err?.message || err);
  }
}
