// قياس الالتزام على القرارات والتوصيات والمهام.
//
// المقاييس (تدخل في تقييم المكلَّف):
//   نسبة الإنجاز  = المنجَز ÷ المُسنَد.
//   دقة التوقيت   = المنجَز في موعده ÷ المنجَز المُستحَق (ذي تاريخ استحقاق).
//   التأخير       = أيام (الإنجاز − الاستحقاق) الموجبة، مسجَّلة على البند نفسه لحظة الإنجاز.
//   التعثّر       = بند متعثر الحالة، أو متأخر عن استحقاقه اليوم، أو رُحِّل لأكثر من محضر.
//   نسبة الالتزام = ٦٠٪ من نسبة الإنجاز + ٤٠٪ من دقة التوقيت.
import type { Env } from '../types';
import { assigneesJson } from './people';
import { effStatusSql } from './status';

export interface AssigneeStats {
  user_id: number;
  name: string;
  role: string;
  stage: string | null;
  color: string | null;
  total: number;
  done: number;
  open: number;
  stalled: number;
  overdue: number;          // مفتوحة تجاوزت استحقاقها اليوم
  on_time: number;
  late: number;
  delay_total: number;      // مجموع أيام التأخير على المنجَز
  delay_max: number;
  delay_avg: number;
  overdue_days_now: number; // مجموع أيام التأخر الجارية على المفتوحة
  carried_total: number;    // مجموع مرات الترحيل بين المحاضر
  completion_rate: number;  // ٪
  timeliness: number;       // ٪ دقة التوقيت
  commitment: number;       // ٪ نسبة الالتزام
}

/** أيام التأخير على بند منجَز: موجب = تأخير، صفر أو سالب = في الموعد. */
const DELAY_SQL = "CAST(julianday(date(completed_at)) - julianday(date(due_date)) AS INTEGER)";

/** إعادة حساب التأخير المخزَّن على بند بعد الإنجاز أو تعديل تاريخه. */
export async function recomputeDelay(env: Env, actionId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE action_items
        SET delay_days = CASE
              WHEN status = 'done' AND completed_at IS NOT NULL AND due_date IS NOT NULL
              THEN ${DELAY_SQL} ELSE NULL END
      WHERE id = ?`,
  ).bind(actionId).run();
}

export interface StatsFilter {
  councilId?: number | null;
  userId?: number | null;    // حصر النتيجة بشخص واحد
  type?: string | null;      // decision | recommendation | task
  from?: string | null;      // تاريخ انعقاد المحضر المصدر (من)
  to?: string | null;
}

function whereOf(f: StatsFilter): { sql: string; binds: any[] } {
  const where: string[] = ["a.status != 'cancelled'"];
  const binds: any[] = [];
  if (f.councilId) { where.push('a.council_id = ?'); binds.push(f.councilId); }
  if (f.type) { where.push('a.type = ?'); binds.push(f.type); }
  if (f.userId) { where.push('aa.user_id = ?'); binds.push(f.userId); }
  if (f.from) { where.push('sm.greg_date >= ?'); binds.push(f.from); }
  if (f.to) { where.push('sm.greg_date <= ?'); binds.push(f.to); }
  return { sql: where.join(' AND '), binds };
}

const AGGREGATES = `
    COUNT(*) AS total,
    SUM(a.status = 'done') AS done,
    SUM(a.status NOT IN ('done','cancelled')) AS open,
    -- متعثّرة: ما مضى استحقاقه ولم يُنجَز، أو ما عُلِّم متعثّرًا يدويًا بلا استحقاق فائت
    SUM(a.status NOT IN ('done','cancelled')
        AND (a.status = 'stalled'
             OR (a.due_date IS NOT NULL AND date(a.due_date) < date('now')))) AS stalled,
    SUM(a.status NOT IN ('done','cancelled') AND a.due_date IS NOT NULL AND a.due_date < date('now')) AS overdue,
    SUM(a.status = 'done' AND a.due_date IS NOT NULL AND COALESCE(a.delay_days, 0) <= 0) AS on_time,
    SUM(a.status = 'done' AND a.due_date IS NOT NULL AND COALESCE(a.delay_days, 0) > 0) AS late,
    COALESCE(SUM(CASE WHEN a.status = 'done' AND a.delay_days > 0 THEN a.delay_days ELSE 0 END), 0) AS delay_total,
    COALESCE(MAX(CASE WHEN a.status = 'done' AND a.delay_days > 0 THEN a.delay_days ELSE 0 END), 0) AS delay_max,
    COALESCE(SUM(CASE WHEN a.status NOT IN ('done','cancelled') AND a.due_date IS NOT NULL AND a.due_date < date('now')
      THEN CAST(julianday(date('now')) - julianday(date(a.due_date)) AS INTEGER) ELSE 0 END), 0) AS overdue_days_now,
    COALESCE(SUM(a.carried_count), 0) AS carried_total`;

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);

function shape(r: any): Omit<AssigneeStats, 'user_id' | 'name' | 'role' | 'stage' | 'color'> {
  const done = r.done ?? 0, total = r.total ?? 0;
  const onTime = r.on_time ?? 0, late = r.late ?? 0;
  const completion = pct(done, total);
  const timeliness = onTime + late > 0 ? pct(onTime, onTime + late) : 0;
  return {
    total, done, open: r.open ?? 0, stalled: r.stalled ?? 0, overdue: r.overdue ?? 0,
    on_time: onTime, late,
    delay_total: r.delay_total ?? 0, delay_max: r.delay_max ?? 0,
    delay_avg: late > 0 ? Math.round(((r.delay_total ?? 0) / late) * 10) / 10 : 0,
    overdue_days_now: r.overdue_days_now ?? 0,
    carried_total: r.carried_total ?? 0,
    completion_rate: completion,
    // بلا بنود مستحقة منجزة لا تُحتسب دقة التوقيت، فلا تُظلم نسبة الالتزام بصفر
    timeliness,
    commitment: onTime + late > 0 ? Math.round(completion * 0.6 + timeliness * 0.4) : completion,
  };
}

/** لوحة الالتزام لكل مكلَّف. */
export async function assigneeStats(env: Env, f: StatsFilter): Promise<AssigneeStats[]> {
  const { sql, binds } = whereOf(f);
  const rows = (await env.DB.prepare(
    `SELECT u.id AS user_id, u.name, u.role, u.stage, u.color, ${AGGREGATES}
       FROM action_assignees aa
       JOIN action_items a ON a.id = aa.action_item_id
       JOIN meetings sm ON sm.id = a.source_meeting_id
       JOIN users u ON u.id = aa.user_id
      WHERE ${sql}
      GROUP BY u.id
      ORDER BY u.name`,
  ).bind(...binds).all<any>()).results;
  return rows.map((r) => ({
    user_id: r.user_id, name: r.name, role: r.role, stage: r.stage, color: r.color, ...shape(r),
  }));
}

/**
 * الإجمالي على نفس التصفية. بلا user_id يشمل كل البنود (حتى بلا مسؤول)،
 * ومعه يقتصر على بنود ذلك المكلَّف.
 */
export async function overallStats(env: Env, f: StatsFilter) {
  const { sql, binds } = whereOf(f);
  const from = f.userId
    ? `action_assignees aa
       JOIN action_items a ON a.id = aa.action_item_id
       JOIN meetings sm ON sm.id = a.source_meeting_id`
    : `action_items a JOIN meetings sm ON sm.id = a.source_meeting_id`;
  const r = await env.DB.prepare(`SELECT ${AGGREGATES} FROM ${from} WHERE ${sql}`).bind(...binds).first<any>();
  return shape(r || {});
}

/** أكثر البنود تعثّرًا: ترحيلًا متكرّرًا أو تأخّرًا مفتوحًا. */
export async function stalledActions(env: Env, f: StatsFilter, limit = 10) {
  const where: string[] = ["a.status NOT IN ('done','cancelled')"];
  const binds: any[] = [];
  if (f.councilId) { where.push('a.council_id = ?'); binds.push(f.councilId); }
  if (f.from) { where.push('sm.greg_date >= ?'); binds.push(f.from); }
  if (f.to) { where.push('sm.greg_date <= ?'); binds.push(f.to); }
  return (await env.DB.prepare(
    `SELECT a.id, a.type, a.display_number, a.text, a.due_date, a.progress,
            ${effStatusSql('a.status', 'a.due_date', "date('now')")} AS status,
            a.carried_count, sm.display_number AS meeting_number,
            CASE WHEN a.due_date IS NOT NULL AND a.due_date < date('now')
                 THEN CAST(julianday(date('now')) - julianday(date(a.due_date)) AS INTEGER) ELSE 0 END AS overdue_days,
            ${assigneesJson('a')} AS assignees
       FROM action_items a JOIN meetings sm ON sm.id = a.source_meeting_id
      WHERE ${where.join(' AND ')}
      ORDER BY overdue_days DESC, a.carried_count DESC, a.due_date
      LIMIT ?`,
  ).bind(...binds, limit).all<any>()).results;
}
