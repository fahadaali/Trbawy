// ترقيات تدريجية للقواعد القائمة (الأعمدة الجديدة). آمنة للتكرار: نتجاهل خطأ العمود الموجود.
import type { Env } from '../types';

const COLUMN_ADDS = [
  "ALTER TABLE meetings ADD COLUMN academic_year TEXT",
  "ALTER TABLE eval_cycles ADD COLUMN academic_year TEXT",
  "ALTER TABLE settings ADD COLUMN current_academic_year TEXT",
  // دورة حياة المستخدم: التعليق والحذف الأرشيفي
  "ALTER TABLE users ADD COLUMN suspended_at TEXT",
  "ALTER TABLE users ADD COLUMN suspended_reason TEXT",
  "ALTER TABLE users ADD COLUMN deleted_at TEXT",
  "ALTER TABLE users ADD COLUMN deleted_by INTEGER",
  "ALTER TABLE users ADD COLUMN deleted_email TEXT",
];

export async function runColumnMigrations(env: Env): Promise<void> {
  for (const sql of COLUMN_ADDS) {
    try { await env.DB.prepare(sql).run(); }
    catch { /* العمود موجود مسبقًا — تجاهُل مقصود */ }
  }
  // تعبئة فترة الدور الجارية لكل مستخدم قديم (أساس الاطلاع التاريخي).
  // تبدأ الفترة من تاريخ إنشاء الحساب حتى لا يُحرم أحد من أرشيفه الحالي.
  try {
    await env.DB.prepare(
      `INSERT INTO user_role_periods (user_id, role, stage, from_at, note)
       SELECT u.id, u.role, u.stage, u.created_at, 'تعبئة أولية'
         FROM users u
        WHERE NOT EXISTS (SELECT 1 FROM user_role_periods p WHERE p.user_id = u.id)`,
    ).run();
  } catch { /* الجدول غير جاهز بعد — يُنشأ في ensureSchema ثم يُعاد المحاولة في الطلب التالي */ }
}
