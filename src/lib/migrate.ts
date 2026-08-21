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
  // قياس الالتزام على بنود القرارات/المهام + سجل ترحيل المتابعة
  "ALTER TABLE action_items ADD COLUMN first_due_date TEXT",
  "ALTER TABLE action_items ADD COLUMN delay_days INTEGER",
  "ALTER TABLE action_items ADD COLUMN carried_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE action_items ADD COLUMN last_carried_meeting_id INTEGER",
  "ALTER TABLE meetings ADD COLUMN followups_frozen_at TEXT",
  // مفاتيح إشعارات الدفع (تُولَّد مرة إن لم تُضبط كأسرار بيئة)
  "ALTER TABLE settings ADD COLUMN push_public_key TEXT",
  "ALTER TABLE settings ADD COLUMN push_private_key TEXT",
  // لون تمييز الشخص في جداول المحاضر والمهام
  "ALTER TABLE users ADD COLUMN color TEXT",
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

/**
 * تعبئة قياسات الالتزام للبنود القائمة (أثر رجعي):
 *   first_due_date — أول استحقاق معروف (نأخذ الحالي مرجعًا للبنود القديمة).
 *   delay_days     — الإنجاز ناقص الاستحقاق بالأيام: موجب = تأخير، صفر أو سالب = في الموعد.
 * تُنفَّذ بعد إنشاء المخطط، وتلمس الصفوف الفارغة فقط فتكون رخيصة عند التكرار.
 */
export async function backfillActionMetrics(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE action_items SET first_due_date = due_date
        WHERE first_due_date IS NULL AND due_date IS NOT NULL`,
    ).run();
    await env.DB.prepare(
      `UPDATE action_items
          SET delay_days = CAST(julianday(date(completed_at)) - julianday(date(due_date)) AS INTEGER)
        WHERE delay_days IS NULL AND status = 'done'
          AND completed_at IS NOT NULL AND due_date IS NOT NULL`,
    ).run();
  } catch (e) {
    console.error('backfill action metrics failed', e);
  }
}
