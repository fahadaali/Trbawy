// التقويم — شهرٌ واحد يُعرض فيه ما في المنصة من مواعيد: اجتماعاتٌ بتواريخها، ومهامُّ
// وقرارات باستحقاقها. لا كيان جديد ولا جدول: هي القراءة نفسها بنافذة زمنية.
//
// والتصفية على الاطلاع هي نفسها المستعملة في شاشتَي المحاضر والمهام حرفًا بحرف —
// الاطلاع الكامل يرى مجالسه، والتاريخي ما أُنشئ داخل نوافذ خدمته، ومن سُجّل في محضر
// أو أُسند إليه بند رآه دائمًا.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import {
  can, councilScope, withinAccessWindow, isLiveMeeting, isOpenAction,
  type CouncilScope,
} from '../permissions';
import { assigneesJson } from '../lib/people';
import { effStatusSql, overdueDaysSql } from '../lib/status';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

/** حدود الشهر الميلادي: أوّله وآخره بصيغة YYYY-MM-DD. */
function monthBounds(year: number, month: number): { from: string; to: string } {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  // اليوم صفر من الشهر التالي هو آخر أيام هذا الشهر (ويصحّ في فبراير الكبيسة)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, '0')}` };
}

app.get('/', async (c) => {
  const u = c.get('user');
  const now = new Date();
  const year = Math.min(2200, Math.max(1900, Number(c.req.query('year')) || now.getUTCFullYear()));
  const month = Math.min(12, Math.max(1, Number(c.req.query('month')) || now.getUTCMonth() + 1));
  const { from, to } = monthBounds(year, month);

  const scopes = new Map<number, CouncilScope>();
  const scopeOf = async (councilId: number, type: string) => {
    let s = scopes.get(councilId);
    if (!s) {
      s = await councilScope(c.env, u, { id: councilId, type: type as any, default_writer_id: null });
      scopes.set(councilId, s);
    }
    return s;
  };

  // ---- الاجتماعات المؤرَّخة داخل الشهر ----
  const meetings: any[] = [];
  if (can(u, 'meetings.view')) {
    const attended = new Set<number>(
      (await c.env.DB.prepare(
        'SELECT meeting_id FROM meeting_attendees WHERE user_id = ? AND is_guest = 0',
      ).bind(u.id).all<{ meeting_id: number }>()).results.map((r) => r.meeting_id),
    );
    const rows = (await c.env.DB.prepare(
      `SELECT m.id, m.council_id, m.display_number, m.title, m.hijri_date, m.greg_date, m.created_at,
              m.start_time, m.end_time, m.location, m.location_type, m.status,
              co.name AS council_name, co.type AS council_type
         FROM meetings m JOIN councils co ON co.id = m.council_id
        WHERE date(m.greg_date) BETWEEN date(?) AND date(?)
        ORDER BY m.greg_date, COALESCE(m.start_time, '99:99'), m.id`,
    ).bind(from, to).all<any>()).results;
    for (const m of rows) {
      const s = await scopeOf(m.council_id, m.council_type);
      const visible = withinAccessWindow(m.created_at, s.windows)
        || (s.level === 'full' && isLiveMeeting(m.status))
        || attended.has(m.id);
      if (visible) meetings.push({ ...m, is_attendee: attended.has(m.id) ? 1 : 0 });
    }
  }

  // ---- البنود المستحقّة داخل الشهر ----
  const actions: any[] = [];
  if (can(u, 'actions.view')) {
    const assigned = new Set<number>(
      (await c.env.DB.prepare('SELECT action_item_id FROM action_assignees WHERE user_id = ?')
        .bind(u.id).all<{ action_item_id: number }>()).results.map((r) => r.action_item_id),
    );
    const rows = (await c.env.DB.prepare(
      `SELECT a.id, a.type, a.council_id, a.display_number, a.text, a.priority, a.due_date,
              a.progress, a.completed_at, a.source_meeting_id,
              ${assigneesJson('a')} AS assignees,
              ${effStatusSql('a.status', 'a.due_date', "date('now')")} AS status,
              ${overdueDaysSql('a.status', 'a.due_date', "date('now')")} AS overdue_days,
              co.name AS council_name, co.type AS council_type,
              m.display_number AS meeting_number,
              COALESCE(m.created_at, a.created_at) AS record_created_at
         FROM action_items a
         JOIN councils co ON co.id = a.council_id
         LEFT JOIN meetings m ON m.id = a.source_meeting_id
        WHERE a.due_date IS NOT NULL AND date(a.due_date) BETWEEN date(?) AND date(?)
        ORDER BY a.due_date, a.id`,
    ).bind(from, to).all<any>()).results;
    for (const a of rows) {
      const s = await scopeOf(a.council_id, a.council_type);
      const visible = withinAccessWindow(a.record_created_at, s.windows)
        || (s.level === 'full' && isOpenAction(a.status))
        || assigned.has(a.id);
      if (visible) actions.push({ ...a, is_mine: assigned.has(a.id) ? 1 : 0 });
    }
  }

  const today = (await c.env.DB.prepare("SELECT date('now') AS d").first<{ d: string }>())!.d;
  return c.json({ year, month, from, to, today, meetings, actions });
});

export default app;
