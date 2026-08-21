// وحدة المحاضر: الدعوة والترويسة، الحضور، البنود، الحالات، الاعتماد والإقفال، الإلغاء.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { audit } from '../lib/audit';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import {
  canViewMeeting, councilScope, withinAccessWindow, isLiveMeeting, hasFullCouncilAccess, canCreateMeeting, canApproveMeeting,
  canEditDraft, canCancelMeeting, canAssignWriter, isPresident,
  type CouncilScope,
} from '../permissions';
import { getCouncil, nextMeetingNumber, formatDisplayNumber, currentAcademicYear } from '../lib/meetings';
import { hijriYear } from '../lib/hijri';
import { shortCode } from '../lib/crypto';
import { arNum } from '../lib/charts';
import { notifyMany } from '../lib/notify';
import { sanitizeHtml } from '../lib/sanitize';
import { computeFollowups, getFollowups, freezeFollowups } from '../lib/followups';
import { assigneesJson } from '../lib/people';
import { effStatusSql, meetingRefSql, overdueDaysSql } from '../lib/status';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

// حالات يجوز فيها التحرير
const EDITABLE = ['invitation', 'draft'];

// تحميل محضر قابل للتحرير مع فحص الحالة والصلاحية — يُرجع استجابة الخطأ جاهزة عند التعذّر
async function loadEditable(c: any, id: number) {
  const db = c.env.DB as D1Database;
  const m = await db.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return { error: c.json({ error: 'المحضر غير موجود' }, 404) };
  const council = await getCouncil(c.env, m.council_id);
  if (!council) return { error: c.json({ error: 'المجلس غير موجود' }, 404) };
  if (!EDITABLE.includes(m.status)) return { error: c.json({ error: 'المحضر مقفل ولا يقبل التعديل' }, 409) };
  if (!canEditDraft(c.get('user'), council, m.writer_id))
    return { error: c.json({ error: 'لا تملك صلاحية تحرير هذا المحضر' }, 403) };
  return { meeting: m, council };
}

// تحويل الأرقام العربية-الهندية إلى لاتينية قبل التحليل
function toEnDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

// تطبيع وقت مكتوب يدويًا إلى "HH:MM".
// يقبل: 09:30 · ٩:٣٠ · 9:30 م · 0930 · 9  — ويُرجع undefined إن تعذّر الفهم، و null للفراغ.
function parseTime(v: unknown): string | null | undefined {
  if (v === null) return null;
  const raw = toEnDigits(String(v ?? '').trim());
  if (!raw) return null;
  const pm = /م|مساء|pm/i.test(raw);
  const am = /ص|صباح|am/i.test(raw);
  let h: number, mi: number;
  const colon = /(\d{1,2})\s*[:.]\s*(\d{1,2})/.exec(raw);
  if (colon) { h = Number(colon[1]); mi = Number(colon[2]); }
  else {
    const d = raw.replace(/\D/g, '');
    if (d.length === 4) { h = Number(d.slice(0, 2)); mi = Number(d.slice(2)); }
    else if (d.length === 3) { h = Number(d.slice(0, 1)); mi = Number(d.slice(1)); }
    else if (d.length >= 1 && d.length <= 2) { h = Number(d); mi = 0; }
    else return undefined;
  }
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  if (h > 23 || mi > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

// ---- بيانات مساعدة لإنشاء محضر جديد ----
app.get('/meta/new', async (c) => {
  const councilId = Number(c.req.query('council_id'));
  const council = await getCouncil(c.env, councilId);
  if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
  if (!canCreateMeeting(c.get('user'), council))
    return c.json({ error: 'لا تملك صلاحية إنشاء محضر لهذا المجلس' }, 403);

  const members = await c.env.DB.prepare(
    `SELECT cm.user_id, cm.position, u.name, u.role FROM council_members cm
       JOIN users u ON u.id = cm.user_id WHERE cm.council_id = ? ORDER BY cm.position DESC, u.name`,
  ).bind(councilId).all();

  const fixed = await c.env.DB.prepare(
    'SELECT title, body FROM fixed_agenda_templates WHERE council_id = ? AND is_active = 1 ORDER BY sort_order',
  ).bind(councilId).all();

  const followups = await previewFollowups(c.env, councilId);

  const hy = hijriYear(new Date());
  const num = await nextMeetingNumber(c.env, councilId, hy);
  return c.json({
    council,
    members: members.results,
    fixed_items: fixed.results,
    followups,
    preview_number: formatDisplayNumber(council.number_prefix, hy, num),
    default_writer_id: council.default_writer_id,
  });
});

// بنود المتابعة المرشّحة لمحضر جديد لم يُنشأ بعد (معاينة الدعوة):
// نُحاكيه كمحضر يُعقد اليوم بعد كل المحاضر القائمة.
async function previewFollowups(env: Env, councilId: number) {
  const today = (await env.DB.prepare("SELECT date('now') AS d").first<{ d: string }>())!.d;
  const last = await env.DB.prepare(
    'SELECT MAX(greg_date) AS d FROM meetings WHERE council_id = ?',
  ).bind(councilId).first<{ d: string | null }>();
  const date = last?.d && last.d > today ? last.d : today;
  // معرّف وهمي أكبر من أي محضر قائم: المحضر المرتقب يأتي بعد كل محاضر اليوم نفسه
  return await computeFollowups(env, { id: Number.MAX_SAFE_INTEGER, council_id: councilId, greg_date: date });
}

// ---- قائمة المحاضر (حسب الصلاحية والفلاتر) ----
app.get('/', async (c) => {
  const u = c.get('user');
  const councilId = c.req.query('council_id');
  const status = c.req.query('status');
  const year = c.req.query('year');
  const academicYear = c.req.query('academic_year');
  const q = c.req.query('q');

  const where: string[] = [];
  const binds: any[] = [];
  if (councilId) { where.push('m.council_id = ?'); binds.push(Number(councilId)); }
  if (status) { where.push('m.status = ?'); binds.push(status); }
  if (year) { where.push('m.hijri_year = ?'); binds.push(Number(year)); }
  if (academicYear) { where.push('m.academic_year = ?'); binds.push(academicYear); }
  if (q) {
    // بحث الأرشيف: العنوان، الرقم، نص البنود، أسماء الحضور، ونص القرارات/المهام المرتبطة.
    const like = '%' + q + '%';
    where.push(`(m.title LIKE ? OR m.display_number LIKE ?
      OR EXISTS (SELECT 1 FROM agenda_items ai WHERE ai.meeting_id = m.id AND (ai.title LIKE ? OR ai.body LIKE ?))
      OR EXISTS (SELECT 1 FROM action_items act WHERE act.source_meeting_id = m.id AND act.text LIKE ?)
      OR EXISTS (SELECT 1 FROM meeting_attendees ma LEFT JOIN users mu ON mu.id = ma.user_id
                  WHERE ma.meeting_id = m.id AND (mu.name LIKE ? OR ma.guest_name LIKE ?)))`);
    binds.push(like, like, like, like, like, like, like);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.council_id, m.display_number, m.title, m.hijri_date, m.greg_date, m.created_at,
            m.status, m.hijri_year, m.academic_year, co.name AS council_name, co.type AS council_type
       FROM meetings m JOIN councils co ON co.id = m.council_id
       ${whereSql} ORDER BY m.id DESC LIMIT 300`,
  ).bind(...binds).all<any>();

  // تصفية دقيقة: اطلاع كامل، أو أرشيف فترة الخدمة السابقة، أو حضور شخصي مسجَّل.
  const attended = new Set<number>(
    (await c.env.DB.prepare(
      'SELECT meeting_id FROM meeting_attendees WHERE user_id = ? AND is_guest = 0',
    ).bind(u.id).all<{ meeting_id: number }>()).results.map((r) => r.meeting_id),
  );
  const scopes = new Map<number, CouncilScope>();
  const out = [];
  for (const m of rows.results) {
    let scope = scopes.get(m.council_id);
    if (!scope) {
      scope = await councilScope(c.env, u, { id: m.council_id, type: m.council_type, default_writer_id: null });
      scopes.set(m.council_id, scope);
    }
    const visible = withinAccessWindow(m.created_at, scope.windows)
      || (scope.level === 'full' && isLiveMeeting(m.status))
      || attended.has(m.id);
    if (visible) out.push({ ...m, read_only: scope.level !== 'full' });
  }
  return c.json({ meetings: out });
});

// ---- السنوات المتاحة للفلترة (هجرية ودراسية) ----
app.get('/meta/years', async (c) => {
  const hijri = await c.env.DB.prepare(
    'SELECT DISTINCT hijri_year AS y FROM meetings ORDER BY y DESC',
  ).all<{ y: number }>();
  const academic = await c.env.DB.prepare(
    "SELECT DISTINCT academic_year AS y FROM meetings WHERE academic_year IS NOT NULL AND academic_year != '' ORDER BY y DESC",
  ).all<{ y: string }>();
  return c.json({
    hijri_years: hijri.results.map((r) => r.y),
    academic_years: academic.results.map((r) => r.y),
    current_academic_year: await currentAcademicYear(c.env),
  });
});

// ---- تفاصيل محضر ----
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
  const scope = await councilScope(c.env, c.get('user'), council);
  if (!(await canViewMeeting(c.env, c.get('user'), m, council, scope)))
    return c.json({ error: 'لا تملك صلاحية الاطلاع على هذا المحضر' }, 403);

  const attendees = await c.env.DB.prepare(
    `SELECT a.id, a.user_id, a.is_guest, a.guest_name, a.guest_title, a.attendance_status,
            a.signed_at, a.signature_hash, a.signature_override, u.name AS user_name, u.role AS user_role
       FROM meeting_attendees a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.meeting_id = ? ORDER BY a.is_guest, a.id`,
  ).bind(id).all();

  const agenda = await c.env.DB.prepare(
    'SELECT id, sort_order, title, body, item_type FROM agenda_items WHERE meeting_id = ? ORDER BY sort_order',
  ).bind(id).all();

  // القرارات/المهام المنشأة في هذا المحضر (مع أسماء المسؤولين)
  // الحالة بمرجع تاريخ انعقاد المحضر: ما مضى استحقاقه ولم يُنجَز متعثّر لا «لم تبدأ»
  const actions = await c.env.DB.prepare(
    `SELECT a.id, a.type, a.display_number, a.text, a.priority, a.due_date, a.progress, a.completed_at,
            ${assigneesJson('a')} AS assignees,
            ${effStatusSql('a.status', 'a.due_date', meetingRefSql())} AS status,
            ${overdueDaysSql('a.status', 'a.due_date', meetingRefSql())} AS overdue_days
       FROM action_items a WHERE a.source_meeting_id = ? ORDER BY a.id`,
  ).bind(m.greg_date, m.greg_date, id).all();

  // جدول المتابعة: يُحسب حيًّا للمحضر المفتوح، ويُقرأ من اللقطة المجمّدة للمحضر المعتمد
  // (فالمحضر المقفل وثيقة ثابتة لا تتبدّل بتغيّر حالة البنود بعد اعتماده).
  const followups = await getFollowups(c.env, m);

  const u = c.get('user');
  const myAtt = attendees.results.find((a: any) => a.user_id === u.id && !a.is_guest);
  const perms = {
    can_edit: canEditDraft(u, council, m.writer_id) && EDITABLE.includes(m.status),
    can_approve: canApproveMeeting(u, council) && m.status === 'awaiting_signatures',
    can_submit: canEditDraft(u, council, m.writer_id) && m.status === 'draft',
    can_cancel: canCancelMeeting(u) && m.status !== 'cancelled',
    can_archive: canApproveMeeting(u, council) && m.status === 'approved',
    can_sign: m.status === 'awaiting_signatures' && !!myAtt && (myAtt as any).attendance_status === 'present' && !(myAtt as any).signed_at,
    can_override: isPresident(u) && m.status === 'awaiting_signatures',
    can_print: ['approved', 'archived', 'awaiting_signatures'].includes(m.status),
    can_amend: canCreateMeeting(u, council) && ['approved', 'archived'].includes(m.status),
    can_revert: m.status === 'awaiting_signatures' &&
      (canEditDraft(u, council, m.writer_id) || canApproveMeeting(u, council)),
  };

  // روابط محاضر التصويب/الملحق
  const parent = m.parent_meeting_id
    ? await c.env.DB.prepare('SELECT id, display_number FROM meetings WHERE id = ?').bind(m.parent_meeting_id).first()
    : null;
  const amendments = (await c.env.DB.prepare(
    'SELECT id, display_number, status FROM meetings WHERE parent_meeting_id = ? ORDER BY id',
  ).bind(id).all()).results;

  // أعضاء المجلس غير المُدرجين في الحضور (أُضيفوا للمجلس بعد إنشاء المحضر)
  const missingMembers = (await c.env.DB.prepare(
    `SELECT cm.user_id, u.name FROM council_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.council_id = ? AND u.is_active = 1 AND u.deleted_at IS NULL
        AND cm.user_id NOT IN (SELECT COALESCE(user_id, -1) FROM meeting_attendees WHERE meeting_id = ?)`,
  ).bind(m.council_id, id).all()).results;

  return c.json({
    meeting: m, council, attendees: attendees.results, agenda: agenda.results,
    actions: actions.results, followups, perms, parent, amendments,
    missing_members: missingMembers,
    // اطلاع تاريخي أو شخصي: قراءة فقط، ويُبيَّن سببه في الواجهة
    read_only: scope.level !== 'full',
    access_level: scope.level,
  });
});

// ---- إنشاء دعوة/محضر ----
app.post('/', async (c) => {
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const council = await getCouncil(c.env, Number(b.council_id));
  if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
  if (!canCreateMeeting(u, council))
    return c.json({ error: 'لا تملك صلاحية إنشاء محضر لهذا المجلس' }, 403);

  const now = new Date();
  const greg = b.greg_date || now.toISOString().slice(0, 10);
  const hijri = b.hijri_date || '';
  const hy = hijriYear(greg ? new Date(greg) : now);
  const number = await nextMeetingNumber(c.env, council.id, hy);
  const display = formatDisplayNumber(council.number_prefix, hy, number);

  // كاتب المحضر: المُرسَل أو الافتراضي — ويجب أن يكون عضوًا في المجلس
  const writerId = b.writer_id != null ? Number(b.writer_id) : council.default_writer_id;
  if (writerId != null) {
    const mem = await c.env.DB.prepare('SELECT 1 FROM council_members WHERE council_id = ? AND user_id = ?').bind(council.id, writerId).first();
    if (!mem) return c.json({ error: 'كاتب المحضر يجب أن يكون عضوًا في المجلس' }, 400);
  }

  // المكان جزء من الوثيقة الرسمية: اجتماع حضوري بلا مكان مذكور، أو لقاء عن بُعد بلا
  // رابط، يترك خانة «المكان» في المحضر بنوعه وحده — وهي نقص لا يُستدرك بعد الاعتماد.
  const place = (b.location || '').trim();
  if (!place) {
    return c.json({
      error: b.location_type === 'remote'
        ? 'أدخل رابط الاجتماع أو وسيلته'
        : 'أدخل مكان الاجتماع (القاعة أو المبنى)',
    }, 400);
  }

  const academicYear = await currentAcademicYear(c.env);
  const res = await c.env.DB.prepare(
    `INSERT INTO meetings
       (council_id, number, hijri_year, display_number, hijri_date, greg_date,
        start_time, end_time, location_type, location, title, status, created_by, writer_id, academic_year)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'invitation', ?, ?, ?)`,
  ).bind(
    council.id, number, hy, display, hijri, greg,
    parseTime(b.start_time) ?? null, parseTime(b.end_time) ?? null,
    b.location_type === 'remote' ? 'remote' : 'in_person', place,
    b.title || null, u.id, writerId, academicYear,
  ).run();

  const meetingId = res.meta.last_row_id as number;

  // الحضور: أعضاء المجلس النشطون (الحالة الافتراضية حاضر) + أي حالات مرسلة.
  // المعلَّق والمحذوف لا يُدرَجان — وإلا بقي المحضر بانتظار توقيع من لا يستطيع الدخول.
  const members = await c.env.DB.prepare(
    `SELECT cm.user_id FROM council_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.council_id = ? AND u.is_active = 1 AND u.deleted_at IS NULL`,
  ).bind(council.id).all<{ user_id: number }>();
  const statusMap: Record<string, string> = {};
  (b.attendees || []).forEach((a: any) => { statusMap[a.user_id] = a.attendance_status; });
  const attStmts = members.results.map((m) =>
    c.env.DB.prepare(
      'INSERT INTO meeting_attendees (meeting_id, user_id, attendance_status) VALUES (?, ?, ?)',
    ).bind(meetingId, m.user_id, statusMap[m.user_id] || 'present'),
  );
  // الضيوف
  (b.guests || []).forEach((g: any) => {
    if (g.name) attStmts.push(c.env.DB.prepare(
      'INSERT INTO meeting_attendees (meeting_id, is_guest, guest_name, guest_title, attendance_status) VALUES (?, 1, ?, ?, ?)',
    ).bind(meetingId, g.name, g.title || null, 'present'));
  });
  if (attStmts.length) await c.env.DB.batch(attStmts);

  // البنود الثابتة تلقائياً + بنود جدول الأعمال المرسلة
  const fixed = await c.env.DB.prepare(
    'SELECT title, body FROM fixed_agenda_templates WHERE council_id = ? AND is_active = 1 ORDER BY sort_order',
  ).bind(council.id).all<any>();
  let order = 0;
  const agStmts: D1PreparedStatement[] = [];
  for (const f of fixed.results)
    agStmts.push(c.env.DB.prepare(
      'INSERT INTO agenda_items (meeting_id, sort_order, title, body, item_type) VALUES (?, ?, ?, ?, ?)',
    ).bind(meetingId, order++, f.title, f.body || null, 'fixed'));
  for (const a of (b.agenda || []))
    if (a.title) agStmts.push(c.env.DB.prepare(
      'INSERT INTO agenda_items (meeting_id, sort_order, title, body, item_type) VALUES (?, ?, ?, ?, ?)',
    ).bind(meetingId, order++, a.title, a.body ? sanitizeHtml(a.body) : null, 'new'));
  if (agStmts.length) await c.env.DB.batch(agStmts);

  // إشعار أعضاء المجلس بالدعوة (بريد + داخل المنصة)
  const memberIds = members.results.map((mm) => mm.user_id).filter((uid) => uid !== u.id);
  await notifyMany(c.env, memberIds, {
    type: 'meeting_invitation', title: 'دعوة اجتماع', body: `${display}${b.title ? ' — ' + b.title : ''}`,
    link: `#/meetings/${meetingId}`,
  });

  await audit(c.env, { userId: u.id, action: 'create_meeting', entityType: 'meeting', entityId: meetingId, newValue: { display, council: council.id } });
  return c.json({ id: meetingId, display_number: display }, 201);
});

// ---- تعديل ترويسة المحضر ----
// التعديل جزئي: يُرسَل الحقل المراد تغييره وحده، وتبقى بقية الحقول كما هي.
app.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const { error, meeting: m, council } = await loadEditable(c, id) as any;
  if (error) return error;

  const b = await c.req.json().catch(() => ({}));
  // الوقت يُقبل بأي صيغة مفهومة (٩:٣٠ ص · 09:30 · 0930) ويُطبَّع قبل الحفظ
  const times: Record<string, string | null> = {};
  for (const k of ['start_time', 'end_time'] as const) {
    if (b[k] === undefined) continue;
    const t = parseTime(b[k]);
    if (t === undefined)
      return c.json({ error: `صيغة ${k === 'start_time' ? 'وقت البداية' : 'وقت النهاية'} غير مفهومة (مثال: ٩:٣٠ ص)` }, 400);
    times[k] = t;
  }
  const f = {
    title: b.title !== undefined ? b.title : m.title,
    hijri_date: b.hijri_date !== undefined ? b.hijri_date : m.hijri_date,
    greg_date: b.greg_date !== undefined ? b.greg_date : m.greg_date,
    start_time: times.start_time !== undefined ? times.start_time : m.start_time,
    end_time: times.end_time !== undefined ? times.end_time : m.end_time,
    location_type: b.location_type !== undefined ? b.location_type : m.location_type,
    location: b.location !== undefined ? b.location : m.location,
    writer_id: b.writer_id !== undefined ? b.writer_id : m.writer_id,
  };
  // تغيير الكاتب مقصور على صاحب صلاحية التعيين، والكاتب يجب أن يكون عضوًا في المجلس
  if (b.writer_id !== undefined && b.writer_id !== m.writer_id) {
    if (!canAssignWriter(c.get('user'), council))
      return c.json({ error: 'لا تملك صلاحية تغيير كاتب المحضر' }, 403);
    if (b.writer_id != null) {
      const mem = await c.env.DB.prepare('SELECT 1 FROM council_members WHERE council_id = ? AND user_id = ?').bind(m.council_id, Number(b.writer_id)).first();
      if (!mem) return c.json({ error: 'كاتب المحضر يجب أن يكون عضوًا في المجلس' }, 400);
    }
  }
  await c.env.DB.prepare(
    `UPDATE meetings SET title=?, hijri_date=?, greg_date=?, start_time=?, end_time=?,
       location_type=?, location=?, writer_id=?, updated_at=datetime('now') WHERE id=?`,
  ).bind(f.title, f.hijri_date, f.greg_date, f.start_time, f.end_time, f.location_type, f.location, f.writer_id, id).run();
  await audit(c.env, { userId: c.get('user').id, action: 'update_meeting', entityType: 'meeting', entityId: id, newValue: f });

  // تغيّر الموعد خبرٌ يعني الأعضاء لا تفصيلًا داخليًّا: من لم يبلغه التغيير حضر
  // في الموعد القديم. ولذلك يُبلَّغ هنا لا في الواجهة — أيًّا كان الطريق الذي غُيّر منه.
  const when = (x: any) => `${x.greg_date}|${x.start_time || ''}|${x.end_time || ''}`;
  if (when(f) !== when(m) && m.status !== 'cancelled') {
    const rows = await c.env.DB.prepare(
      `SELECT ma.user_id FROM meeting_attendees ma JOIN users u ON u.id = ma.user_id
        WHERE ma.meeting_id = ? AND ma.is_guest = 0 AND u.is_active = 1 AND u.deleted_at IS NULL`,
    ).bind(id).all<{ user_id: number }>();
    await notifyMany(c.env, rows.results.map((r) => r.user_id).filter((uid) => uid !== c.get('user').id), {
      type: 'meeting_rescheduled',
      title: 'تغيّر موعد الاجتماع',
      body: `${m.display_number} — الموعد الجديد: ${arDateTime(f.greg_date, f.start_time)}`,
      link: `#/meetings/${id}`,
    });
  }
  return c.json({ ok: true });
});

/** «٢٠٢٦/٠٩/٣٠ الساعة ٩:٣٠ ص» — لنصّ إشعارٍ يقرؤه عضو على جواله. */
function arDateTime(date: string | null, time: string | null): string {
  const d = arNum(String(date || '').slice(0, 10).replace(/-/g, '/'));
  if (!time) return d;
  const [h, mn] = String(time).split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d} الساعة ${arNum(h12)}:${arNum(String(mn).padStart(2, '0'))} ${h < 12 ? 'ص' : 'م'}`;
}

// ---- استبدال بنود جدول الأعمال (تحرير جماعي من نافذة «تعديل البنود») ----
app.put('/:id/agenda', async (c) => {
  const id = Number(c.req.param('id'));
  const { error } = await loadEditable(c, id) as any;
  if (error) return error;

  const b = await c.req.json().catch(() => ({}));
  const items = Array.isArray(b.items) ? b.items : [];
  await c.env.DB.prepare('DELETE FROM agenda_items WHERE meeting_id = ?').bind(id).run();
  if (items.length) {
    await c.env.DB.batch(items.map((it: any, i: number) =>
      c.env.DB.prepare(
        'INSERT INTO agenda_items (meeting_id, sort_order, title, body, item_type) VALUES (?, ?, ?, ?, ?)',
      ).bind(id, i, it.title || '(بند)', it.body ? sanitizeHtml(it.body) : null, ['fixed', 'followup', 'new'].includes(it.item_type) ? it.item_type : 'new'),
    ));
  }
  await audit(c.env, { userId: c.get('user').id, action: 'update_agenda', entityType: 'meeting', entityId: id });
  return c.json({ ok: true });
});

// ---- تحرير البنود بندًا بندًا (من داخل صفحة المحضر مباشرة) ----
const MAX_TITLE = 300;

// إضافة بند جديد في نهاية الجدول
app.post('/:id/agenda', async (c) => {
  const id = Number(c.req.param('id'));
  const { error } = await loadEditable(c, id) as any;
  if (error) return error;

  const b = await c.req.json().catch(() => ({}));
  const title = String(b.title ?? '').trim().slice(0, MAX_TITLE);
  if (!title) return c.json({ error: 'عنوان البند مطلوب' }, 400);
  const last = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS mx FROM agenda_items WHERE meeting_id = ?',
  ).bind(id).first<{ mx: number }>();
  const order = (last?.mx ?? -1) + 1;
  const res = await c.env.DB.prepare(
    'INSERT INTO agenda_items (meeting_id, sort_order, title, body, item_type) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, order, title, b.body ? sanitizeHtml(String(b.body)) : null, 'new').run();
  await audit(c.env, { userId: c.get('user').id, action: 'add_agenda_item', entityType: 'meeting', entityId: id, newValue: { title } });
  return c.json({ id: res.meta.last_row_id, sort_order: order, item_type: 'new' }, 201);
});

// تعديل عنوان بند أو محتواه (يُرسَل الحقل المعدَّل وحده)
app.patch('/:id/agenda/:itemId', async (c) => {
  const id = Number(c.req.param('id'));
  const itemId = Number(c.req.param('itemId'));
  const { error } = await loadEditable(c, id) as any;
  if (error) return error;

  const item = await c.env.DB.prepare('SELECT * FROM agenda_items WHERE id = ? AND meeting_id = ?')
    .bind(itemId, id).first<any>();
  if (!item) return c.json({ error: 'البند غير موجود' }, 404);

  const b = await c.req.json().catch(() => ({}));
  let title = item.title as string;
  if (b.title !== undefined) {
    title = String(b.title).trim().slice(0, MAX_TITLE);
    if (!title) return c.json({ error: 'عنوان البند مطلوب' }, 400);
  }
  const body = b.body !== undefined
    ? (b.body ? sanitizeHtml(String(b.body)) : null)
    : item.body;

  await c.env.DB.prepare('UPDATE agenda_items SET title = ?, body = ? WHERE id = ?')
    .bind(title, body, itemId).run();
  await audit(c.env, {
    userId: c.get('user').id, action: 'update_agenda_item', entityType: 'meeting', entityId: id,
    oldValue: { id: itemId, title: item.title }, newValue: { id: itemId, title },
  });
  return c.json({ ok: true, body });
});

// حذف بند
app.delete('/:id/agenda/:itemId', async (c) => {
  const id = Number(c.req.param('id'));
  const itemId = Number(c.req.param('itemId'));
  const { error } = await loadEditable(c, id) as any;
  if (error) return error;

  const res = await c.env.DB.prepare('DELETE FROM agenda_items WHERE id = ? AND meeting_id = ?')
    .bind(itemId, id).run();
  if (!res.meta.changes) return c.json({ error: 'البند غير موجود' }, 404);
  await audit(c.env, { userId: c.get('user').id, action: 'delete_agenda_item', entityType: 'meeting', entityId: id, oldValue: { id: itemId } });
  return c.json({ ok: true });
});

// إعادة الترتيب بقائمة المعرّفات بالترتيب الجديد
app.put('/:id/agenda/order', async (c) => {
  const id = Number(c.req.param('id'));
  const { error } = await loadEditable(c, id) as any;
  if (error) return error;

  const b = await c.req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return c.json({ error: 'قائمة الترتيب مطلوبة' }, 400);
  await c.env.DB.batch(ids.map((itemId, i) =>
    c.env.DB.prepare('UPDATE agenda_items SET sort_order = ? WHERE id = ? AND meeting_id = ?').bind(i, itemId, id)));
  await audit(c.env, { userId: c.get('user').id, action: 'reorder_agenda', entityType: 'meeting', entityId: id, newValue: { ids } });
  return c.json({ ok: true });
});

// ---- تحديث الحضور والحالات ----
app.put('/:id/attendees', async (c) => {
  const id = Number(c.req.param('id'));
  const { error, meeting: m } = await loadEditable(c, id) as any;
  if (error) return error;

  const b = await c.req.json().catch(() => ({}));
  // تحديث حالات الأعضاء — ومن لم يكن مُدرجًا (عضو أُضيف للمجلس لاحقًا) يُضاف
  for (const a of (b.attendees || [])) {
    const st = ['present', 'apology', 'absent'].includes(a.attendance_status) ? a.attendance_status : 'present';
    const res = await c.env.DB.prepare(
      'UPDATE meeting_attendees SET attendance_status = ? WHERE meeting_id = ? AND user_id = ?',
    ).bind(st, id, a.user_id).run();
    if (!res.meta.changes) {
      // يُقبل فقط إن كان عضوًا في المجلس
      const isMember = await c.env.DB.prepare(
        'SELECT 1 FROM council_members WHERE council_id = ? AND user_id = ?',
      ).bind(m.council_id, a.user_id).first();
      if (isMember) {
        await c.env.DB.prepare(
          'INSERT INTO meeting_attendees (meeting_id, user_id, attendance_status) VALUES (?, ?, ?)',
        ).bind(id, a.user_id, st).run();
      }
    }
  }
  // إعادة ضبط الضيوف
  if (Array.isArray(b.guests)) {
    await c.env.DB.prepare('DELETE FROM meeting_attendees WHERE meeting_id = ? AND is_guest = 1').bind(id).run();
    for (const g of b.guests) {
      if (g.name) await c.env.DB.prepare(
        'INSERT INTO meeting_attendees (meeting_id, is_guest, guest_name, guest_title, attendance_status) VALUES (?, 1, ?, ?, ?)',
      ).bind(id, g.name, g.title || null, 'present').run();
    }
  }
  return c.json({ ok: true });
});

// ---- تحوّلات الحالة ----
app.post('/:id/status', async (c) => {
  const id = Number(c.req.param('id'));
  const { action } = await c.req.json().catch(() => ({}));
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, m.council_id);
  const u = c.get('user');

  let newStatus: string | null = null;
  if (action === 'start_draft' && m.status === 'invitation') {
    if (!canEditDraft(u, council!, m.writer_id)) return c.json({ error: 'لا تملك صلاحية' }, 403);
    newStatus = 'draft';
  } else if (action === 'submit' && m.status === 'draft') {
    if (!canEditDraft(u, council!, m.writer_id)) return c.json({ error: 'لا تملك صلاحية' }, 403);
    // آخر فرصة لاستدراك نقص في الترويسة: بعد الإرسال للتوقيعات تُقفل ولا تُعدَّل.
    // المكان أكثر ما يُنسى لأنه يُكتب سهوًا في خانة «عنوان الاجتماع».
    if (!String(m.location || '').trim()) {
      return c.json({
        error: m.location_type === 'remote'
          ? 'أضف رابط الاجتماع أو وسيلته من «تعديل الترويسة» قبل الإرسال للتوقيعات'
          : 'أضف مكان الاجتماع من «تعديل الترويسة» قبل الإرسال للتوقيعات — لا يُعدَّل بعد الإرسال',
      }, 409);
    }
    newStatus = 'awaiting_signatures';
  } else if (action === 'revert' && m.status === 'awaiting_signatures') {
    // إرجاع إلى المسودة لتصحيح خطأ قبل الاعتماد — تُلغى التوقيعات والتجاوزات.
    if (!canEditDraft(u, council!, m.writer_id) && !canApproveMeeting(u, council!))
      return c.json({ error: 'لا تملك صلاحية إرجاع المحضر للمسودة' }, 403);
    await c.env.DB.prepare(
      `UPDATE meeting_attendees SET signed_at = NULL, signature_hash = NULL,
         signature_override = 0, override_reason = NULL WHERE meeting_id = ?`,
    ).bind(id).run();
    newStatus = 'draft';
  } else if (action === 'approve' && m.status === 'awaiting_signatures') {
    if (!canApproveMeeting(u, council!)) return c.json({ error: 'لا تملك صلاحية الاعتماد' }, 403);
    // لا يُعتمد المحضر إلا بعد اكتمال توقيعات الحاضرين (أو تجاوزها بتسجيل السبب).
    const pending = await c.env.DB.prepare(
      `SELECT COALESCE(u2.name, '') AS name FROM meeting_attendees a LEFT JOIN users u2 ON u2.id = a.user_id
        WHERE a.meeting_id = ? AND a.is_guest = 0 AND a.attendance_status = 'present'
          AND a.signed_at IS NULL AND a.signature_override = 0`,
    ).bind(id).all<{ name: string }>();
    if (pending.results.length) {
      return c.json({ error: 'لا يمكن الاعتماد قبل اكتمال التوقيعات', pending: pending.results.map((r) => r.name) }, 409);
    }
    newStatus = 'approved';
  } else if (action === 'archive' && m.status === 'approved') {
    if (!canApproveMeeting(u, council!)) return c.json({ error: 'لا تملك صلاحية' }, 403);
    newStatus = 'archived';
  } else {
    return c.json({ error: 'تحوّل حالة غير صالح' }, 400);
  }

  if (newStatus === 'approved') {
    const verifyCode = m.verify_code || shortCode(10);
    await c.env.DB.prepare(
      "UPDATE meetings SET status = ?, approved_at = datetime('now'), approved_by = ?, verify_code = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind(newStatus, u.id, verifyCode, id).run();
    // تجميد جدول المتابعة: تُحفظ حالة كل بند مُرحَّل كما هي لحظة الاعتماد، ويُؤشَّر
    // المنجَز بأنه وُثِّق (فلا يظهر في محضر لاحق) ويرتفع عدّاد الترحيل لغير المنجَز.
    await freezeFollowups(c.env, m);
  } else {
    await c.env.DB.prepare("UPDATE meetings SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(newStatus, id).run();
  }
  // إشعارات تحوّل الحالة
  if (newStatus === 'awaiting_signatures') {
    const present = await c.env.DB.prepare(
      "SELECT user_id FROM meeting_attendees WHERE meeting_id = ? AND is_guest = 0 AND attendance_status = 'present' AND user_id IS NOT NULL",
    ).bind(id).all<{ user_id: number }>();
    await notifyMany(c.env, present.results.map((r) => r.user_id), {
      type: 'awaiting_signature', title: 'محضر بانتظار توقيعك', body: m.display_number,
      link: `#/meetings/${id}`,
    });
  } else if (newStatus === 'approved') {
    const memb = await c.env.DB.prepare('SELECT user_id FROM council_members WHERE council_id = ?').bind(m.council_id).all<{ user_id: number }>();
    await notifyMany(c.env, memb.results.map((r) => r.user_id), {
      type: 'meeting_approved', title: 'اعتماد محضر', body: m.display_number, link: `#/meetings/${id}`,
    });
  }

  await audit(c.env, { userId: u.id, action: 'meeting_' + action, entityType: 'meeting', entityId: id, oldValue: { status: m.status }, newValue: { status: newStatus } });
  return c.json({ ok: true, status: newStatus });
});

// ---- إلغاء المحضر (الرئيس فقط) ----
app.post('/:id/cancel', async (c) => {
  const id = Number(c.req.param('id'));
  const { reason } = await c.req.json().catch(() => ({}));
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  if (!canCancelMeeting(c.get('user'))) return c.json({ error: 'الإلغاء متاح للرئيس فقط' }, 403);
  if (m.status === 'cancelled') return c.json({ error: 'المحضر ملغى مسبقاً' }, 409);
  if (!reason) return c.json({ error: 'سبب الإلغاء مطلوب' }, 400);

  await c.env.DB.prepare(
    "UPDATE meetings SET status = 'cancelled', cancel_reason = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(reason, id).run();
  await audit(c.env, { userId: c.get('user').id, action: 'cancel_meeting', entityType: 'meeting', entityId: id, oldValue: { status: m.status }, newValue: { reason } });
  return c.json({ ok: true });
});

// ---- إنشاء محضر تصويب/ملحق مرتبط بالمحضر الأصلي ----
app.post('/:id/amend', async (c) => {
  const id = Number(c.req.param('id'));
  const orig = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!orig) return c.json({ error: 'المحضر الأصلي غير موجود' }, 404);
  if (!['approved', 'archived'].includes(orig.status))
    return c.json({ error: 'التصويب يكون على محضر معتمد فقط' }, 409);
  const council = await getCouncil(c.env, orig.council_id);
  const u = c.get('user');
  if (!canCreateMeeting(u, council!)) return c.json({ error: 'لا تملك صلاحية إنشاء محضر تصويب لهذا المجلس' }, 403);

  const now = new Date();
  const greg = now.toISOString().slice(0, 10);
  const hy = hijriYear(now);
  const number = await nextMeetingNumber(c.env, council!.id, hy);
  const display = formatDisplayNumber(council!.number_prefix, hy, number);

  // المكان والوقت يُنقلان من المحضر الأصل: محضر التصويب يُعقد في سياقه نفسه، وإسقاط
  // المكان كان يترك خانته في الوثيقة الرسمية بنوعه وحده («حضوري») بلا اسم مكان.
  const year = await currentAcademicYear(c.env);
  const res = await c.env.DB.prepare(
    `INSERT INTO meetings (council_id, number, hijri_year, display_number, hijri_date, greg_date,
        start_time, end_time, location_type, location, title, status, created_by, writer_id,
        parent_meeting_id, academic_year)
     VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, 'invitation', ?, ?, ?, ?)`,
  ).bind(council!.id, number, hy, display, greg,
    orig.start_time, orig.end_time, orig.location_type || 'in_person', orig.location,
    `محضر تصويب/ملحق للمحضر ${orig.display_number}`, u.id,
    orig.writer_id || council!.default_writer_id, id, year).run();
  const newId = res.meta.last_row_id as number;

  // نسخ أعضاء المجلس كحضور مبدئي
  const members = await c.env.DB.prepare('SELECT user_id FROM council_members WHERE council_id = ?').bind(council!.id).all<{ user_id: number }>();
  if (members.results.length) await c.env.DB.batch(members.results.map((m) =>
    c.env.DB.prepare('INSERT INTO meeting_attendees (meeting_id, user_id, attendance_status) VALUES (?, ?, ?)').bind(newId, m.user_id, 'present')));

  await audit(c.env, { userId: u.id, action: 'create_amendment', entityType: 'meeting', entityId: newId, newValue: { parent: id, display } });
  return c.json({ id: newId, display_number: display }, 201);
});

// ---- نسخ محضر سابق كقالب لمحضر جديد ----
app.post('/:id/duplicate', async (c) => {
  const srcId = Number(c.req.param('id'));
  const src = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(srcId).first<any>();
  if (!src) return c.json({ error: 'المحضر المصدر غير موجود' }, 404);
  const council = await getCouncil(c.env, src.council_id);
  const u = c.get('user');
  if (!canCreateMeeting(u, council!)) return c.json({ error: 'لا تملك صلاحية إنشاء محضر لهذا المجلس' }, 403);

  const b = await c.req.json().catch(() => ({}));
  const now = new Date();
  const greg = b.greg_date || now.toISOString().slice(0, 10);
  const hy = hijriYear(new Date(greg));
  const number = await nextMeetingNumber(c.env, council!.id, hy);
  const display = formatDisplayNumber(council!.number_prefix, hy, number);
  const year = await currentAcademicYear(c.env);

  const res = await c.env.DB.prepare(
    `INSERT INTO meetings (council_id, number, hijri_year, display_number, hijri_date, greg_date,
        start_time, end_time, location_type, location, title, status, created_by, writer_id, academic_year)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'invitation', ?, ?, ?)`,
  ).bind(council!.id, number, hy, display, b.hijri_date || '', greg,
    src.start_time, src.end_time, src.location_type, src.location,
    b.title || src.title, u.id, src.writer_id || council!.default_writer_id, year).run();
  const newId = res.meta.last_row_id as number;

  // نسخ الحضور (أعضاء المجلس الحاليون) والبنود
  const members = await c.env.DB.prepare('SELECT user_id FROM council_members WHERE council_id = ?')
    .bind(council!.id).all<{ user_id: number }>();
  if (members.results.length) await c.env.DB.batch(members.results.map((mm) =>
    c.env.DB.prepare('INSERT INTO meeting_attendees (meeting_id, user_id, attendance_status) VALUES (?, ?, ?)')
      .bind(newId, mm.user_id, 'present')));

  const items = await c.env.DB.prepare(
    'SELECT title, body, item_type, sort_order FROM agenda_items WHERE meeting_id = ? ORDER BY sort_order',
  ).bind(srcId).all<any>();
  if (items.results.length) await c.env.DB.batch(items.results.map((it: any, i: number) =>
    c.env.DB.prepare('INSERT INTO agenda_items (meeting_id, sort_order, title, body, item_type) VALUES (?, ?, ?, ?, ?)')
      .bind(newId, i, it.title, it.body, it.item_type === 'followup' ? 'new' : it.item_type)));

  await audit(c.env, { userId: u.id, action: 'duplicate_meeting', entityType: 'meeting', entityId: newId, newValue: { from: srcId, display } });
  return c.json({ id: newId, display_number: display }, 201);
});

// ---- مرفقات المحضر ----
app.get('/:id/attachments', async (c) => {
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT id, council_id, created_at FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!(await canViewMeeting(c.env, c.get('user'), m, council!))) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.file_name, a.uploaded_at, u.name AS uploaded_by_name FROM meeting_attachments a
       LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.meeting_id = ? ORDER BY a.id`,
  ).bind(id).all();
  return c.json({ attachments: rows.results });
});

app.put('/:id/attachments', async (c) => {
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!canEditDraft(c.get('user'), council!, m.writer_id)) return c.json({ error: 'لا تملك صلاحية' }, 403);
  if (!EDITABLE.includes(m.status)) return c.json({ error: 'المحضر مقفل' }, 409);
  const fileName = c.req.query('name') || 'attachment';
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return c.json({ error: 'الملف فارغ' }, 400);
  const key = `meetings/${id}/${Date.now()}_${fileName}`;
  await c.env.FILES.put(key, body, { httpMetadata: { contentType: c.req.header('content-type') || 'application/octet-stream' } });
  const res = await c.env.DB.prepare(
    'INSERT INTO meeting_attachments (meeting_id, r2_key, file_name, uploaded_by) VALUES (?, ?, ?, ?)',
  ).bind(id, key, fileName, c.get('user').id).run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

app.get('/:id/attachments/:attId', async (c) => {
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT id, council_id, created_at FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!(await canViewMeeting(c.env, c.get('user'), m, council!))) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const row = await c.env.DB.prepare('SELECT r2_key, file_name FROM meeting_attachments WHERE id = ? AND meeting_id = ?')
    .bind(Number(c.req.param('attId')), id).first<any>();
  if (!row) return c.json({ error: 'المرفق غير موجود' }, 404);
  const obj = await c.env.FILES.get(row.r2_key);
  if (!obj) return c.json({ error: 'الملف غير موجود' }, 404);
  return new Response(obj.body, {
    headers: { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}` },
  });
});

app.delete('/:id/attachments/:attId', async (c) => {
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!canEditDraft(c.get('user'), council!, m.writer_id)) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const row = await c.env.DB.prepare('SELECT r2_key FROM meeting_attachments WHERE id = ? AND meeting_id = ?')
    .bind(Number(c.req.param('attId')), id).first<any>();
  if (row) { try { await c.env.FILES.delete(row.r2_key); } catch { /* قد يكون محذوفًا */ } }
  await c.env.DB.prepare('DELETE FROM meeting_attachments WHERE id = ? AND meeting_id = ?')
    .bind(Number(c.req.param('attId')), id).run();
  return c.json({ ok: true });
});

// ---- تعليقات المسودة (مناقشة قبل الاعتماد) ----
app.get('/:id/comments', async (c) => {
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT id, council_id, created_at FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!(await canViewMeeting(c.env, c.get('user'), m, council!))) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT cm.id, cm.body, cm.created_at, cm.user_id, u.name AS user_name FROM meeting_comments cm
       JOIN users u ON u.id = cm.user_id WHERE cm.meeting_id = ? ORDER BY cm.id`,
  ).bind(id).all();
  return c.json({ comments: rows.results });
});

app.post('/:id/comments', async (c) => {
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, m.council_id);
  const u = c.get('user');
  // الكتابة (التعليق) تتطلب اطلاعًا كاملًا حاليًا — الاطلاع التاريخي للقراءة فقط
  if (!hasFullCouncilAccess(u, council!)) return c.json({ error: 'لا تملك صلاحية' }, 403);
  if (['approved', 'archived', 'cancelled'].includes(m.status))
    return c.json({ error: 'المحضر مقفل — لا تُقبل تعليقات جديدة' }, 409);
  const { body } = await c.req.json().catch(() => ({}));
  if (!body || !String(body).trim()) return c.json({ error: 'نص التعليق مطلوب' }, 400);
  const res = await c.env.DB.prepare('INSERT INTO meeting_comments (meeting_id, user_id, body) VALUES (?, ?, ?)')
    .bind(id, u.id, String(body).trim()).run();

  // إشعار كاتب المحضر ومنشئه (عدا صاحب التعليق)
  const targets = [m.writer_id, m.created_by].filter((x) => x && x !== u.id) as number[];
  await notifyMany(c.env, [...new Set(targets)], {
    type: 'meeting_comment', title: 'تعليق جديد على محضر',
    body: `${m.display_number}: ${String(body).slice(0, 120)}`, link: `#/meetings/${id}`,
  });
  return c.json({ id: res.meta.last_row_id }, 201);
});

app.delete('/:id/comments/:cid', async (c) => {
  const id = Number(c.req.param('id'));
  const cid = Number(c.req.param('cid'));
  const u = c.get('user');
  const row = await c.env.DB.prepare('SELECT user_id FROM meeting_comments WHERE id = ? AND meeting_id = ?')
    .bind(cid, id).first<any>();
  if (!row) return c.json({ error: 'التعليق غير موجود' }, 404);
  if (row.user_id !== u.id && !isPresident(u)) return c.json({ error: 'يمكن حذف تعليقك فقط' }, 403);
  await c.env.DB.prepare('DELETE FROM meeting_comments WHERE id = ?').bind(cid).run();
  return c.json({ ok: true });
});

// ---- التوقيع الإلكتروني (الحاضرون فقط) ----
app.post('/:id/sign', async (c) => {
  const id = Number(c.req.param('id'));
  const u = c.get('user');
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  if (m.status !== 'awaiting_signatures')
    return c.json({ error: 'المحضر ليس في مرحلة التوقيع' }, 409);

  const att = await c.env.DB.prepare(
    'SELECT * FROM meeting_attendees WHERE meeting_id = ? AND user_id = ? AND is_guest = 0',
  ).bind(id, u.id).first<any>();
  if (!att) return c.json({ error: 'لست ضمن حضور هذا المحضر' }, 403);
  if (att.attendance_status !== 'present') return c.json({ error: 'التوقيع مطلوب من الحاضرين فقط' }, 403);
  if (att.signed_at) return c.json({ error: 'لقد وقّعت مسبقاً' }, 409);

  const code = shortCode(10); // رمز تحقق فريد
  await c.env.DB.prepare(
    "UPDATE meeting_attendees SET signed_at = datetime('now'), signature_hash = ? WHERE id = ?",
  ).bind(code, att.id).run();
  await audit(c.env, { userId: u.id, action: 'sign_meeting', entityType: 'meeting', entityId: id, newValue: { code } });
  return c.json({ ok: true, code });
});

// ---- تجاوز التوقيع (الرئيس فقط، مع تسجيل السبب) ----
app.post('/:id/override/:userId', async (c) => {
  const id = Number(c.req.param('id'));
  const userId = Number(c.req.param('userId'));
  if (!isPresident(c.get('user'))) return c.json({ error: 'تجاوز التوقيع متاح للرئيس فقط' }, 403);
  const { reason } = await c.req.json().catch(() => ({}));
  if (!reason) return c.json({ error: 'سبب التجاوز مطلوب' }, 400);
  const att = await c.env.DB.prepare(
    'SELECT * FROM meeting_attendees WHERE meeting_id = ? AND user_id = ? AND is_guest = 0',
  ).bind(id, userId).first<any>();
  if (!att) return c.json({ error: 'العضو غير موجود في الحضور' }, 404);
  await c.env.DB.prepare(
    'UPDATE meeting_attendees SET signature_override = 1, override_reason = ? WHERE id = ?',
  ).bind(reason, att.id).run();
  await audit(c.env, { userId: c.get('user').id, action: 'override_signature', entityType: 'meeting', entityId: id, newValue: { user: userId, reason } });
  return c.json({ ok: true });
});

export default app;
