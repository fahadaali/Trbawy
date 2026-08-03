// ترقيات تدريجية للقواعد القائمة. آمنة للتكرار: نتجاهل خطأ العمود الموجود.
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

/**
 * إضافة الأعمدة الناقصة للجداول القائمة.
 * تُنفَّذ **قبل** إنشاء المخطط: فـ CREATE TABLE IF NOT EXISTS لا يعدّل جدولًا قائمًا،
 * وأي فهرس جديد على عمود جديد سيفشل ما لم يُضَف العمود أولًا.
 */
export async function addMissingColumns(env: Env): Promise<void> {
  for (const sql of COLUMN_ADDS) {
    try { await env.DB.prepare(sql).run(); }
    catch { /* العمود موجود مسبقًا أو الجدول لم يُنشأ بعد — تجاهُل مقصود */ }
  }
}

/**
 * تعبئة فترة الدور الجارية لكل مستخدم بلا فترة (أساس الاطلاع التاريخي).
 * تبدأ من تاريخ إنشاء الحساب حتى لا يُحرم أحد من أرشيفه القائم.
 * تُنفَّذ **بعد** إنشاء المخطط لأنها تحتاج جدول user_role_periods.
 */
export async function backfillRolePeriods(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO user_role_periods (user_id, role, stage, from_at, note)
       SELECT u.id, u.role, u.stage, u.created_at, 'تعبئة أولية'
         FROM users u
        WHERE NOT EXISTS (SELECT 1 FROM user_role_periods p WHERE p.user_id = u.id)`,
    ).run();
  } catch (e) {
    console.error('backfill role periods failed', e);
  }
}
