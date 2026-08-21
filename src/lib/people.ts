// تمييز الأشخاص بلون ثابت.
//
// لكل مستخدم لون محفوظ عليه (users.color) يُستعمل في كل المحاضر وكل المجالس،
// فيصير التعرّف على مهام شخص بعينه بصريًا لا بقراءة الأسماء. اللون يُولَّد مرة
// عند إنشاء المستخدم ويبقى قابلًا للتعديل من إعدادات المستخدمين.
import type { Env } from '../types';

/**
 * لوحة ألوان بعيدة عن دلالات الحالة (الأخضر منجَز، الذهبي جارٍ، الأحمر متأخر)
 * حتى لا يختلط لون الشخص بلون حالة البند. كلها داكنة بما يكفي للقراءة فوق
 * خلفية فاتحة من اللون نفسه.
 */
export const PERSON_PALETTE = [
  '#2c6e9b', '#7a4fa3', '#b0468a', '#0f766e', '#b45309', '#4d7c0f',
  '#9d174d', '#1e40af', '#6d28d9', '#0e7490', '#7c2d12', '#475569',
];

/** لون افتراضي ثابت لمعرّف المستخدم — نفسه في كل مكان وكل مرة. */
export function defaultPersonColor(userId: number): string {
  return PERSON_PALETTE[Math.abs(userId) % PERSON_PALETTE.length];
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isValidColor = (c: unknown): c is string => typeof c === 'string' && HEX.test(c);

/** تحويل #RRGGBB إلى rgba بشفافية — لخلفية الشارة وحدّها. */
export function tint(hex: string, alpha: number): string {
  const h = isValidColor(hex) ? hex : '#475569';
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export interface Person { n: string; c?: string | null }

/**
 * أسماء المسؤولين عن بند كمصفوفة JSON (اسم + لون) بدل نص مسرود.
 * `alias` هو اسم جدول البنود في الاستعلام المُضيف.
 */
export const assigneesJson = (alias = 'a') =>
  `(SELECT json_group_array(json_object('n', u.name, 'c', COALESCE(u.color, '')))
      FROM action_assignees aa JOIN users u ON u.id = aa.user_id
     WHERE aa.action_item_id = ${alias}.id)`;

export function parsePeople(json: string | null | undefined): Person[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((p) => p && p.n) : [];
  } catch { return []; }
}

/** تعبئة ألوان المستخدمين القدامى مرة واحدة (أثر رجعي). */
export async function backfillPersonColors(env: Env): Promise<void> {
  try {
    const rows = (await env.DB.prepare(
      "SELECT id FROM users WHERE color IS NULL OR color = ''",
    ).all<{ id: number }>()).results;
    if (!rows.length) return;
    await env.DB.batch(rows.map((r) => env.DB.prepare('UPDATE users SET color = ? WHERE id = ?')
      .bind(defaultPersonColor(r.id), r.id)));
  } catch (e) {
    console.error('backfill person colors failed', e);
  }
}
