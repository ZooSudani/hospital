-- شغّل هذا الملف مرة واحدة في D1 Console (قاعدتك الحالية فيها الجداول مسبقًا)
CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_slot ON appointments (tenant_id, doctor_id, starts_at) WHERE status = 'scheduled';
