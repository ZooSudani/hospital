// تحديد محاولات الدخول (ضد التخمين). المفاتيح: مستخدم (رمز المستشفى + البريد)، وعنوان العميل.
// الجدول غير مرتبط بمستشفى لأن الفحص يجري قبل معرفة هوية المستخدم.
const WINDOW_SECONDS = 15 * 60;
const now = () => Math.floor(Date.now() / 1000);

export async function isLocked(db, key, limit) {
  const row = await db.prepare(`SELECT fails, window_start FROM login_attempts WHERE key = ?`).bind(key).first();
  return !!row && now() - row.window_start <= WINDOW_SECONDS && row.fails >= limit;
}

export async function recordFailure(db, key) {
  const t = now();
  await db
    .prepare(
      `INSERT INTO login_attempts (key, fails, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         fails = CASE WHEN ? - window_start > ? THEN 1 ELSE fails + 1 END,
         window_start = CASE WHEN ? - window_start > ? THEN ? ELSE window_start END`
    )
    .bind(key, t, t, WINDOW_SECONDS, t, WINDOW_SECONDS, t)
    .run();
}

export async function clearFailures(db, key) {
  await db.prepare(`DELETE FROM login_attempts WHERE key = ?`).bind(key).run();
}
