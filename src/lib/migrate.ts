// ترقيات تدريجية للقواعد القائمة (الأعمدة الجديدة). آمنة للتكرار: نتجاهل خطأ العمود الموجود.
import type { Env } from '../types';

const COLUMN_ADDS = [
  "ALTER TABLE meetings ADD COLUMN academic_year TEXT",
  "ALTER TABLE eval_cycles ADD COLUMN academic_year TEXT",
  "ALTER TABLE settings ADD COLUMN current_academic_year TEXT",
];

export async function runColumnMigrations(env: Env): Promise<void> {
  for (const sql of COLUMN_ADDS) {
    try { await env.DB.prepare(sql).run(); }
    catch { /* العمود موجود مسبقًا — تجاهُل مقصود */ }
  }
}
