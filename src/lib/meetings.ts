// أدوات مساعدة لوحدة المحاضر: جلب المجلس، الترقيم التلقائي، تنسيق المعرّف.
import type { Env } from '../types';
import type { CouncilRow } from '../permissions';
import { toArabicDigits } from './hijri';

export interface FullCouncil extends CouncilRow {
  name: string;
  number_prefix: string;
}

export async function getCouncil(env: Env, id: number): Promise<FullCouncil | null> {
  return await env.DB.prepare(
    'SELECT id, name, type, number_prefix, default_writer_id FROM councils WHERE id = ?',
  )
    .bind(id)
    .first<FullCouncil>();
}

// الرقم التالي للمحضر ضمن مجلس/سنة هجرية
export async function nextMeetingNumber(env: Env, councilId: number, hijriYear: number): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(MAX(number), 0) AS m FROM meetings WHERE council_id = ? AND hijri_year = ?',
  )
    .bind(councilId, hijriYear)
    .first<{ m: number }>();
  return (row?.m ?? 0) + 1;
}

// صيغة المعرّف: تربوي/١٤٤٧/٠٠٣
export function formatDisplayNumber(prefix: string, hijriYear: number, number: number): string {
  const padded = String(number).padStart(3, '0');
  return `${prefix}/${toArabicDigits(hijriYear)}/${toArabicDigits(padded)}`;
}

// ترقيم القرارات/التوصيات/المهام — تسلسل مستقل لكل مجلس ونوع.
const ACTION_LETTER: Record<string, string> = { decision: 'ق', recommendation: 'ت', task: 'م' };

export async function nextActionNumber(env: Env, councilId: number, type: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(MAX(number), 0) AS m FROM action_items WHERE council_id = ? AND type = ?',
  )
    .bind(councilId, type)
    .first<{ m: number }>();
  return (row?.m ?? 0) + 1;
}

export function formatActionNumber(prefix: string, type: string, number: number): string {
  const padded = String(number).padStart(3, '0');
  return `${ACTION_LETTER[type] || 'ب'}/${prefix}/${toArabicDigits(padded)}`;
}
