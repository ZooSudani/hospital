-- شغّل هذا الملف مرة واحدة في D1 Console قبل رفع تحديث الصلاحيات.
ALTER TABLE users ADD COLUMN perm_overrides TEXT;
