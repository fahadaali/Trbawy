// ترحيل بنود المتابعة بين المحاضر.
//
// القاعدة المعتمدة (§٤٫٣):
//   • البند غير المنجَز يُرحَّل إلى المحضر التالي، ثم الذي يليه، وهكذا حتى يُنجَز.
//   • حين يُنجَز يظهر **مرة أخيرة واحدة** في أول محضر بعد إنجازه للتوثيق (is_final)
//     ثم لا يظهر بعدها أبدًا.
//   • البند الملغى لا يُرحَّل.
//
// المحضر المفتوح يُحسب جدول متابعته حيًّا، والمحضر المعتمد تُجمَّد لقطته في
// meeting_followups فلا يتبدّل محضر مقفل بتغيّر حالة البنود لاحقًا.
import type { Env } from '../types';
import { assigneesJson } from './people';
import { effStatusSql, meetingRefSql, overdueDaysSql } from './status';

export interface FollowupRow {
  id: number;
  type: string;
  display_number: string;
  text: string;
  status: string;
  priority: string;
  due_date: string | null;
  progress: number;
  completed_at: string | null;
  delay_days: number | null;
  source_meeting_id: number;
  source_meeting_number: string | null;
  assignees: string | null;   // مصفوفة JSON: [{n: الاسم, c: اللون}]
  overdue_days: number;      // أيام التأخر عن الاستحقاق (٠ = لا تأخر) وقت هذا المحضر
  is_final: number;          // 1 = ظهور التوثيق الأخير بعد الإنجاز
  carried_index: number;     // ترتيب هذا الترحيل للبند (١ = أول ترحيل)
  reconstructed?: number;    // 1 = صف أُعيد بناؤه لمحضر قديم
}

export interface MeetingRef {
  id: number;
  council_id: number;
  greg_date: string;
  approved_at?: string | null;
  status?: string;
}

// نهاية المدى الزمني للمحضر: وقت الاعتماد إن وُجد، وإلا آخر يوم انعقاده.
function boundaryOf(m: MeetingRef): string {
  return m.approved_at || `${m.greg_date} 23:59:59`;
}

// ترتيب المحاضر: تاريخ الانعقاد ثم المعرّف — «قبل هذا المحضر» يعني أسبق في هذا الترتيب.
const EARLIER_MEETING = `(sm.greg_date < ? OR (sm.greg_date = ? AND sm.id < ?))`;

const ASSIGNEES_SQL = assigneesJson('a');

/**
 * الحساب الحيّ لجدول المتابعة (للمحاضر التي لم تُجمَّد بعد).
 * يشمل كل بند من محضر أسبق لم يُوثَّق إنجازه في محضر سابق:
 * غير المنجَز يُرحَّل بحالته الجارية، والمنجَز يظهر ظهوره الأخير للتوثيق.
 */
export async function computeFollowups(env: Env, m: MeetingRef): Promise<FollowupRow[]> {
  const rows = (await env.DB.prepare(
    `SELECT a.id, a.type, a.display_number, a.text, a.priority, a.due_date,
            a.progress, a.completed_at, a.delay_days, a.carried_count, a.source_meeting_id,
            sm.display_number AS source_meeting_number,
            ${effStatusSql('a.status', 'a.due_date', meetingRefSql())} AS status,
            ${overdueDaysSql('a.status', 'a.due_date', meetingRefSql())} AS overdue_days,
            ${ASSIGNEES_SQL} AS assignees
       FROM action_items a
       JOIN meetings sm ON sm.id = a.source_meeting_id
      WHERE a.council_id = ? AND a.source_meeting_id != ?
        AND a.status != 'cancelled'
        AND ${EARLIER_MEETING}
        -- بند وُثِّق إنجازه في محضر آخر لا يظهر ثانية، ما لم يُعَد فتحه فيُرحَّل من جديد
        AND NOT (a.status = 'done' AND EXISTS (
          SELECT 1 FROM meeting_followups mf
           WHERE mf.action_item_id = a.id AND mf.is_final = 1 AND mf.meeting_id != ?))
      ORDER BY a.status = 'done', a.due_date IS NULL, a.due_date, a.id`,
  ).bind(m.greg_date, m.greg_date, m.council_id, m.id, m.greg_date, m.greg_date, m.id, m.id).all<any>()).results;

  return rows.map((r) => ({
    id: r.id, type: r.type, display_number: r.display_number, text: r.text,
    status: r.status, priority: r.priority, due_date: r.due_date, progress: r.progress,
    completed_at: r.completed_at, delay_days: r.delay_days,
    source_meeting_id: r.source_meeting_id, source_meeting_number: r.source_meeting_number,
    assignees: r.assignees, overdue_days: r.overdue_days ?? 0,
    is_final: r.status === 'done' ? 1 : 0,
    carried_index: (r.carried_count ?? 0) + 1,
  }));
}

/** اللقطة المجمّدة لمحضر معتمد. */
export async function frozenFollowups(env: Env, meetingId: number): Promise<FollowupRow[]> {
  return (await env.DB.prepare(
    `SELECT a.id, a.type, a.display_number, a.text, a.priority, a.source_meeting_id,
            mf.progress, mf.due_date, mf.completed_at, mf.delay_days,
            mf.is_final, mf.carried_index, mf.reconstructed,
            sm.display_number AS source_meeting_number,
            ${effStatusSql('mf.status', 'mf.due_date', meetingRefSql('mm.greg_date'))} AS status,
            ${overdueDaysSql('mf.status', 'mf.due_date', meetingRefSql('mm.greg_date'))} AS overdue_days,
            ${ASSIGNEES_SQL} AS assignees
       FROM meeting_followups mf
       JOIN action_items a ON a.id = mf.action_item_id
       JOIN meetings mm ON mm.id = mf.meeting_id
       LEFT JOIN meetings sm ON sm.id = a.source_meeting_id
      WHERE mf.meeting_id = ?
      ORDER BY mf.is_final, mf.due_date IS NULL, mf.due_date, a.id`,
  ).bind(meetingId).all<FollowupRow>()).results;
}

/**
 * جدول متابعة المحضر: المجمَّد إن كان مقفلًا، وإلا الحساب الحيّ.
 * المحاضر القديمة المعتمدة قبل تفعيل السجل تُعاد بناء لقطتها عند أول طلب (أثر رجعي).
 */
export async function getFollowups(env: Env, m: MeetingRef & { followups_frozen_at?: string | null }): Promise<FollowupRow[]> {
  const locked = m.status === 'approved' || m.status === 'archived';
  if (!locked) return await computeFollowups(env, m);
  if (!m.followups_frozen_at) await rebuildCouncilFollowups(env, m.council_id);
  return await frozenFollowups(env, m.id);
}

/**
 * تجميد جدول المتابعة عند اعتماد المحضر: يُثبِّت حالة كل بند مُرحَّل كما هي لحظة
 * الاعتماد، ويرفع عدّاد الترحيل على البند (مؤشر التعثّر)، ويؤشّر البنود المنجَزة
 * بأنها وُثِّقت فلا تظهر في محضر لاحق.
 */
export async function freezeFollowups(env: Env, m: MeetingRef & { followups_frozen_at?: string | null }): Promise<void> {
  if (m.followups_frozen_at) return; // مجمَّد سابقًا — لا يُعاد رفع عدّاد الترحيل
  const rows = await computeFollowups(env, m);
  const stmts = [];
  for (const f of rows) {
    stmts.push(env.DB.prepare(
      `INSERT OR REPLACE INTO meeting_followups
         (meeting_id, action_item_id, status, progress, due_date, completed_at, delay_days,
          is_final, carried_index, reconstructed, snapshot_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
    ).bind(m.id, f.id, f.status, f.progress ?? 0, f.due_date, f.completed_at,
      f.delay_days, f.is_final, f.carried_index));
    stmts.push(env.DB.prepare(
      `UPDATE action_items SET carried_count = ?, last_carried_meeting_id = ?,
         reported_done_meeting_id = CASE WHEN ? = 1 THEN ? ELSE reported_done_meeting_id END
        WHERE id = ?`,
    ).bind(f.carried_index, m.id, f.is_final, m.id, f.id));
  }
  stmts.push(env.DB.prepare("UPDATE meetings SET followups_frozen_at = datetime('now') WHERE id = ?").bind(m.id));
  await env.DB.batch(stmts);
}

/**
 * إعادة بناء سجل الترحيل لمحاضر مجلس معتمدة سبقت تفعيل السجل (أثر رجعي).
 * تُعاد الحالة التاريخية من الطوابع الزمنية المتاحة: البند الذي أُنجِز قبل اعتماد
 * المحضر يُوثَّق فيه، وما عداه يُرحَّل. الصفوف المُعاد بناؤها مؤشَّرة (reconstructed).
 */
export async function rebuildCouncilFollowups(env: Env, councilId: number): Promise<void> {
  const meetings = (await env.DB.prepare(
    `SELECT id, council_id, greg_date, approved_at, status, followups_frozen_at
       FROM meetings
      WHERE council_id = ? AND status IN ('approved','archived')
      ORDER BY greg_date, id`,
  ).bind(councilId).all<any>()).results;
  if (!meetings.length) return;

  const items = (await env.DB.prepare(
    `SELECT a.id, a.status, a.progress, a.due_date, a.completed_at, a.delay_days,
            a.source_meeting_id, sm.greg_date AS source_date
       FROM action_items a JOIN meetings sm ON sm.id = a.source_meeting_id
      WHERE a.council_id = ? AND a.status != 'cancelled'
      ORDER BY a.id`,
  ).bind(councilId).all<any>()).results;
  if (!items.length) {
    const mark = meetings.filter((m: any) => !m.followups_frozen_at)
      .map((m: any) => env.DB.prepare("UPDATE meetings SET followups_frozen_at = datetime('now') WHERE id = ?").bind(m.id));
    if (mark.length) await env.DB.batch(mark);
    return;
  }

  const documented = new Set<number>();
  const carried = new Map<number, number>();
  const stmts = [];

  for (const mt of meetings) {
    // محضر مجمَّد سابقًا: نقرأ لقطته لتحديث الحالة ولا نمسّه.
    if (mt.followups_frozen_at) {
      const prev = (await env.DB.prepare(
        'SELECT action_item_id, is_final, carried_index FROM meeting_followups WHERE meeting_id = ?',
      ).bind(mt.id).all<any>()).results;
      for (const r of prev) {
        carried.set(r.action_item_id, r.carried_index);
        if (r.is_final) documented.add(r.action_item_id);
      }
      continue;
    }

    const boundary = boundaryOf(mt);
    for (const it of items) {
      if (it.source_meeting_id === mt.id || documented.has(it.id)) continue;
      // بنود المحاضر الأسبق فقط
      if (!(it.source_date < mt.greg_date || (it.source_date === mt.greg_date && it.source_meeting_id < mt.id))) continue;

      const doneBefore = !!it.completed_at && it.completed_at <= boundary;
      const idx = (carried.get(it.id) ?? 0) + 1;
      carried.set(it.id, idx);
      if (doneBefore) documented.add(it.id);

      stmts.push(env.DB.prepare(
        `INSERT OR IGNORE INTO meeting_followups
           (meeting_id, action_item_id, status, progress, due_date, completed_at, delay_days,
            is_final, carried_index, reconstructed, snapshot_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      ).bind(
        mt.id, it.id,
        doneBefore ? 'done' : (it.status === 'done' ? 'in_progress' : it.status),
        doneBefore ? 100 : (it.status === 'done' ? 0 : (it.progress ?? 0)),
        it.due_date, doneBefore ? it.completed_at : null,
        doneBefore ? it.delay_days : null,
        doneBefore ? 1 : 0, idx, mt.approved_at || mt.greg_date,
      ));
    }
    stmts.push(env.DB.prepare(
      "UPDATE meetings SET followups_frozen_at = ? WHERE id = ?",
    ).bind(mt.approved_at || mt.greg_date, mt.id));
  }

  // عدّاد الترحيل على البند نفسه (مؤشر التعثّر) — أعلى ترتيب بلغه في المحاضر المجمّدة
  for (const [actionId, idx] of carried) {
    stmts.push(env.DB.prepare(
      'UPDATE action_items SET carried_count = MAX(COALESCE(carried_count, 0), ?) WHERE id = ?',
    ).bind(idx, actionId));
  }
  // D1 يحدّ حجم الدفعة — نُقسّمها
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

/** إعادة بناء سجل الترحيل لكل المجالس — تُستدعى مرة عند الإقلاع (أثر رجعي). */
export async function backfillFollowupLedger(env: Env): Promise<void> {
  try {
    const pending = (await env.DB.prepare(
      `SELECT DISTINCT council_id FROM meetings
        WHERE status IN ('approved','archived') AND followups_frozen_at IS NULL`,
    ).all<{ council_id: number }>()).results;
    for (const c of pending) await rebuildCouncilFollowups(env, c.council_id);
  } catch (e) {
    console.error('backfill followup ledger failed', e);
  }
}
