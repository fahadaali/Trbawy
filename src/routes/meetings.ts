// وحدة المحاضر: الدعوة والترويسة، الحضور، البنود، الحالات، الاعتماد والإقفال، الإلغاء.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { audit } from '../lib/audit';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import {
  canViewCouncil, canCreateMeeting, canApproveMeeting, canEditDraft, canCancelMeeting, isPresident,
} from '../permissions';
import { getCouncil, nextMeetingNumber, formatDisplayNumber } from '../lib/meetings';
import { hijriYear } from '../lib/hijri';
import { shortCode } from '../lib/crypto';
import { notifyMany } from '../lib/notify';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

// حالات يجوز فيها التحرير
const EDITABLE = ['invitation', 'draft'];

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

  const followups = await openFollowups(c.env, councilId, null);

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

// القرارات/المهام المفتوحة من محاضر سابقة (بنود المتابعة).
// تظهر: كل ما لم يُنجَز بعد + ما أُنجِز ولم يُبلَّغ عنه في محضر معتمد سابق (يظهر مرة واحدة).
async function openFollowups(env: Env, councilId: number, excludeMeetingId: number | null) {
  const rows = await env.DB.prepare(
    `SELECT a.id, a.type, a.display_number, a.text, a.status, a.priority, a.due_date,
            a.progress, a.completed_at, a.source_meeting_id
       FROM action_items a
      WHERE a.council_id = ?
        AND (a.source_meeting_id != ? OR ? IS NULL)
        AND (
          a.status IN ('not_started','in_progress','stalled')
          OR (a.status = 'done' AND a.reported_done_meeting_id IS NULL)
        )
      ORDER BY a.status, a.id`,
  ).bind(councilId, excludeMeetingId ?? -1, excludeMeetingId).all();
  return rows.results;
}

// ---- قائمة المحاضر (حسب الصلاحية والفلاتر) ----
app.get('/', async (c) => {
  const u = c.get('user');
  const councilId = c.req.query('council_id');
  const status = c.req.query('status');
  const year = c.req.query('year');
  const q = c.req.query('q');

  const where: string[] = [];
  const binds: any[] = [];
  if (councilId) { where.push('m.council_id = ?'); binds.push(Number(councilId)); }
  if (status) { where.push('m.status = ?'); binds.push(status); }
  if (year) { where.push('m.hijri_year = ?'); binds.push(Number(year)); }
  if (q) { where.push('(m.title LIKE ? OR m.display_number LIKE ?)'); binds.push('%' + q + '%', '%' + q + '%'); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.council_id, m.display_number, m.title, m.hijri_date, m.greg_date,
            m.status, m.hijri_year, co.name AS council_name, co.type AS council_type
       FROM meetings m JOIN councils co ON co.id = m.council_id
       ${whereSql} ORDER BY m.id DESC LIMIT 300`,
  ).bind(...binds).all<any>();

  // تصفية حسب صلاحية الاطلاع
  const out = [];
  for (const m of rows.results) {
    const council = { id: m.council_id, type: m.council_type, default_writer_id: null };
    if (await canViewCouncil(c.env, u, council as any)) out.push(m);
  }
  return c.json({ meetings: out });
});

// ---- تفاصيل محضر ----
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
  if (!(await canViewCouncil(c.env, c.get('user'), council)))
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

  // القرارات/المهام المنشأة في هذا المحضر
  const actions = await c.env.DB.prepare(
    `SELECT id, type, display_number, text, status, priority, due_date, progress, completed_at
       FROM action_items WHERE source_meeting_id = ? ORDER BY id`,
  ).bind(id).all();

  // بنود المتابعة (مفتوحة من محاضر سابقة) — تظهر عند التحرير
  const followups = EDITABLE.includes(m.status) ? await openFollowups(c.env, m.council_id, id) : [];

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
  };

  return c.json({
    meeting: m, council, attendees: attendees.results, agenda: agenda.results,
    actions: actions.results, followups, perms,
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

  // كاتب المحضر: المُرسَل أو الافتراضي
  const writerId = b.writer_id != null ? Number(b.writer_id) : council.default_writer_id;

  const res = await c.env.DB.prepare(
    `INSERT INTO meetings
       (council_id, number, hijri_year, display_number, hijri_date, greg_date,
        start_time, end_time, location_type, location, title, status, created_by, writer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'invitation', ?, ?)`,
  ).bind(
    council.id, number, hy, display, hijri, greg,
    b.start_time || null, b.end_time || null,
    b.location_type === 'remote' ? 'remote' : 'in_person', b.location || null,
    b.title || null, u.id, writerId,
  ).run();

  const meetingId = res.meta.last_row_id as number;

  // الحضور: أعضاء المجلس (الحالة الافتراضية حاضر) + أي حالات مرسلة
  const members = await c.env.DB.prepare('SELECT user_id FROM council_members WHERE council_id = ?')
    .bind(council.id).all<{ user_id: number }>();
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
    ).bind(meetingId, order++, a.title, a.body || null, 'new'));
  if (agStmts.length) await c.env.DB.batch(agStmts);

  // إشعار أعضاء المجلس بالدعوة (بريد + داخل المنصة)
  const memberIds = members.results.map((mm) => mm.user_id).filter((uid) => uid !== u.id);
  await notifyMany(c.env, memberIds, {
    type: 'meeting_invitation', title: 'دعوة اجتماع', body: `${display}${b.title ? ' — ' + b.title : ''}`,
    link: `#/meetings/${meetingId}`, email: true,
  });

  await audit(c.env, { userId: u.id, action: 'create_meeting', entityType: 'meeting', entityId: meetingId, newValue: { display, council: council.id } });
  return c.json({ id: meetingId, display_number: display }, 201);
});

// ---- تعديل ترويسة المحضر ----
app.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
  if (!EDITABLE.includes(m.status)) return c.json({ error: 'المحضر مقفل ولا يقبل التعديل' }, 409);
  if (!canEditDraft(c.get('user'), council, m.writer_id))
    return c.json({ error: 'لا تملك صلاحية تحرير هذا المحضر' }, 403);

  const b = await c.req.json().catch(() => ({}));
  const f = {
    title: b.title !== undefined ? b.title : m.title,
    hijri_date: b.hijri_date !== undefined ? b.hijri_date : m.hijri_date,
    greg_date: b.greg_date !== undefined ? b.greg_date : m.greg_date,
    start_time: b.start_time !== undefined ? b.start_time : m.start_time,
    end_time: b.end_time !== undefined ? b.end_time : m.end_time,
    location_type: b.location_type !== undefined ? b.location_type : m.location_type,
    location: b.location !== undefined ? b.location : m.location,
    writer_id: b.writer_id !== undefined ? b.writer_id : m.writer_id,
  };
  // تغيير الكاتب مقصور على صاحب صلاحية التعيين
  if (b.writer_id !== undefined && b.writer_id !== m.writer_id) {
    const { canAssignWriter } = await import('../permissions');
    if (!canAssignWriter(c.get('user'), council))
      return c.json({ error: 'لا تملك صلاحية تغيير كاتب المحضر' }, 403);
  }
  await c.env.DB.prepare(
    `UPDATE meetings SET title=?, hijri_date=?, greg_date=?, start_time=?, end_time=?,
       location_type=?, location=?, writer_id=?, updated_at=datetime('now') WHERE id=?`,
  ).bind(f.title, f.hijri_date, f.greg_date, f.start_time, f.end_time, f.location_type, f.location, f.writer_id, id).run();
  await audit(c.env, { userId: c.get('user').id, action: 'update_meeting', entityType: 'meeting', entityId: id, newValue: f });
  return c.json({ ok: true });
});

// ---- استبدال بنود جدول الأعمال ----
app.put('/:id/agenda', async (c) => {
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!EDITABLE.includes(m.status)) return c.json({ error: 'المحضر مقفل' }, 409);
  if (!canEditDraft(c.get('user'), council!, m.writer_id)) return c.json({ error: 'لا تملك صلاحية' }, 403);

  const b = await c.req.json().catch(() => ({}));
  const items = Array.isArray(b.items) ? b.items : [];
  await c.env.DB.prepare('DELETE FROM agenda_items WHERE meeting_id = ?').bind(id).run();
  if (items.length) {
    await c.env.DB.batch(items.map((it: any, i: number) =>
      c.env.DB.prepare(
        'INSERT INTO agenda_items (meeting_id, sort_order, title, body, item_type) VALUES (?, ?, ?, ?, ?)',
      ).bind(id, i, it.title || '(بند)', it.body || null, ['fixed', 'followup', 'new'].includes(it.item_type) ? it.item_type : 'new'),
    ));
  }
  await audit(c.env, { userId: c.get('user').id, action: 'update_agenda', entityType: 'meeting', entityId: id });
  return c.json({ ok: true });
});

// ---- تحديث الحضور والحالات ----
app.put('/:id/attendees', async (c) => {
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<any>();
  if (!m) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, m.council_id);
  if (!EDITABLE.includes(m.status)) return c.json({ error: 'المحضر مقفل' }, 409);
  if (!canEditDraft(c.get('user'), council!, m.writer_id)) return c.json({ error: 'لا تملك صلاحية' }, 403);

  const b = await c.req.json().catch(() => ({}));
  // تحديث حالات الأعضاء
  for (const a of (b.attendees || [])) {
    const st = ['present', 'apology', 'absent'].includes(a.attendance_status) ? a.attendance_status : 'present';
    await c.env.DB.prepare(
      'UPDATE meeting_attendees SET attendance_status = ? WHERE meeting_id = ? AND user_id = ?',
    ).bind(st, id, a.user_id).run();
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
    newStatus = 'awaiting_signatures';
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
    // تأشير المهام المنجزة التي ظهرت في جدول متابعة هذا المحضر كـ«مُبلَّغ عنها»
    // حتى تختفي من متابعة المحاضر اللاحقة (تظهر مرة واحدة كمنجزة).
    await c.env.DB.prepare(
      `UPDATE action_items SET reported_done_meeting_id = ?
        WHERE council_id = ? AND status = 'done'
          AND reported_done_meeting_id IS NULL AND source_meeting_id != ?`,
    ).bind(id, m.council_id, id).run();
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
      link: `#/meetings/${id}`, email: true,
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
