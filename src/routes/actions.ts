// القرارات والتوصيات والمهام — كيان مستقل، لوحة مهامي، الإنجاز، المرفقات.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { audit } from '../lib/audit';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { canViewCouncil, canEditDraft, isPresident } from '../permissions';
import { getCouncil, nextActionNumber, formatActionNumber } from '../lib/meetings';
import { notifyMany } from '../lib/notify';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

const TYPES = ['decision', 'recommendation', 'task'];
const STATUSES = ['not_started', 'in_progress', 'done', 'stalled', 'cancelled'];
const PRIORITIES = ['high', 'medium', 'low'];
const EDITABLE_MEETING = ['invitation', 'draft', 'awaiting_signatures'];

async function loadAction(env: Env, id: number) {
  return await env.DB.prepare('SELECT * FROM action_items WHERE id = ?').bind(id).first<any>();
}
async function assigneesOf(env: Env, id: number) {
  const r = await env.DB.prepare(
    `SELECT aa.user_id, u.name FROM action_assignees aa JOIN users u ON u.id = aa.user_id WHERE aa.action_item_id = ?`,
  ).bind(id).all();
  return r.results as any[];
}
async function isAssignee(env: Env, actionId: number, userId: number): Promise<boolean> {
  const r = await env.DB.prepare('SELECT 1 FROM action_assignees WHERE action_item_id = ? AND user_id = ?')
    .bind(actionId, userId).first();
  return !!r;
}

// ---- إنشاء قرار/توصية/مهمة ضمن محضر ----
app.post('/meeting/:meetingId', async (c) => {
  const meetingId = Number(c.req.param('meetingId'));
  const meeting = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(meetingId).first<any>();
  if (!meeting) return c.json({ error: 'المحضر غير موجود' }, 404);
  const council = await getCouncil(c.env, meeting.council_id);
  if (!EDITABLE_MEETING.includes(meeting.status)) return c.json({ error: 'المحضر مقفل' }, 409);
  if (!canEditDraft(c.get('user'), council!, meeting.writer_id))
    return c.json({ error: 'لا تملك صلاحية إضافة بنود لهذا المحضر' }, 403);

  const b = await c.req.json().catch(() => ({}));
  const type = TYPES.includes(b.type) ? b.type : 'task';
  const text = (b.text || '').trim();
  if (!text) return c.json({ error: 'نص البند مطلوب' }, 400);
  if (type === 'task' && !b.due_date) return c.json({ error: 'تاريخ الاستحقاق إلزامي للمهمة' }, 400);
  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'medium';

  const number = await nextActionNumber(c.env, council!.id, type);
  const display = formatActionNumber(council!.number_prefix, type, number);

  const res = await c.env.DB.prepare(
    `INSERT INTO action_items (type, council_id, source_meeting_id, number, display_number, text, priority, due_date, status, progress)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_started', 0)`,
  ).bind(type, council!.id, meetingId, number, display, text, priority, b.due_date || null).run();
  const actionId = res.meta.last_row_id as number;

  const assignees: number[] = Array.isArray(b.assignees) ? b.assignees.map(Number) : [];
  if (assignees.length) {
    await c.env.DB.batch(assignees.map((uid) =>
      c.env.DB.prepare('INSERT OR IGNORE INTO action_assignees (action_item_id, user_id) VALUES (?, ?)').bind(actionId, uid)));
    // إشعار المسؤولين (بريد + داخل المنصة)
    await notifyMany(c.env, assignees, {
      type: 'action_assigned',
      title: 'إسناد ' + (type === 'task' ? 'مهمة' : type === 'decision' ? 'قرار' : 'توصية'),
      body: text, link: '#/tasks',
    });
  }

  await audit(c.env, { userId: c.get('user').id, action: 'create_action', entityType: 'action_item', entityId: actionId, newValue: { type, display, text } });
  return c.json({ id: actionId, display_number: display }, 201);
});

// ---- قائمة القرارات/المهام ----
app.get('/', async (c) => {
  const u = c.get('user');
  const mine = c.req.query('mine') === '1';
  const type = c.req.query('type');
  const status = c.req.query('status');
  const councilId = c.req.query('council_id');

  const where: string[] = [];
  const binds: any[] = [];
  if (type && TYPES.includes(type)) { where.push('a.type = ?'); binds.push(type); }
  if (status && STATUSES.includes(status)) { where.push('a.status = ?'); binds.push(status); }
  if (councilId) { where.push('a.council_id = ?'); binds.push(Number(councilId)); }
  let join = '';
  if (mine) { join = 'JOIN action_assignees aa ON aa.action_item_id = a.id AND aa.user_id = ?'; binds.unshift(u.id); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT a.id, a.type, a.council_id, a.display_number, a.text, a.priority, a.due_date,
            a.status, a.progress, a.completed_at, a.source_meeting_id,
            co.name AS council_name, co.type AS council_type, m.display_number AS meeting_number
       FROM action_items a
       JOIN councils co ON co.id = a.council_id
       LEFT JOIN meetings m ON m.id = a.source_meeting_id
       ${join} ${whereSql}
      ORDER BY a.status='done', a.due_date IS NULL, a.due_date, a.id DESC LIMIT 400`,
  ).bind(...binds).all<any>();

  // تصفية حسب صلاحية الاطلاع على المجلس (ما لم تكن "مهامي")
  const out = [];
  for (const a of rows.results) {
    if (mine || (await canViewCouncil(c.env, u, { id: a.council_id, type: a.council_type, default_writer_id: null } as any)))
      out.push(a);
  }
  return c.json({ actions: out });
});

// ---- تفاصيل ----
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await loadAction(c.env, id);
  if (!a) return c.json({ error: 'البند غير موجود' }, 404);
  const council = await getCouncil(c.env, a.council_id);
  if (!(await canViewCouncil(c.env, c.get('user'), council!)) && !(await isAssignee(c.env, id, c.get('user').id)))
    return c.json({ error: 'لا تملك صلاحية الاطلاع' }, 403);

  const assignees = await assigneesOf(c.env, id);
  const attachments = await c.env.DB.prepare(
    'SELECT id, file_name, uploaded_at FROM action_attachments WHERE action_item_id = ? ORDER BY id',
  ).bind(id).all();
  const meeting = await c.env.DB.prepare('SELECT id, display_number FROM meetings WHERE id = ?').bind(a.source_meeting_id).first();
  return c.json({ action: a, assignees, attachments: attachments.results, meeting });
});

// ---- تعديل بند (نص/أولوية/استحقاق/مسؤولون/حالة/نسبة) ----
app.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await loadAction(c.env, id);
  if (!a) return c.json({ error: 'البند غير موجود' }, 404);
  const council = await getCouncil(c.env, a.council_id);
  const meeting = await c.env.DB.prepare('SELECT status, writer_id FROM meetings WHERE id = ?').bind(a.source_meeting_id).first<any>();
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));

  const isManager = canEditDraft(u, council!, meeting?.writer_id) || isPresident(u);
  const assignee = await isAssignee(c.env, id, u.id);

  // تعديل النص/الأولوية/الاستحقاق/المسؤولين: للمدير وبينما المحضر قابل للتحرير فقط
  // (المحضر المعتمد مقفل — أي تصحيح يكون عبر محضر تصويب/ملحق).
  const editingCore = b.text !== undefined || b.priority !== undefined || b.due_date !== undefined || b.assignees !== undefined;
  if (editingCore) {
    if (!isManager) return c.json({ error: 'لا تملك صلاحية تعديل البند' }, 403);
    if (!EDITABLE_MEETING.includes(meeting?.status)) return c.json({ error: 'المحضر مقفل — لا يمكن تعديل نص البند' }, 409);
    const text = b.text !== undefined ? String(b.text).trim() : a.text;
    const priority = b.priority !== undefined && PRIORITIES.includes(b.priority) ? b.priority : a.priority;
    const due = b.due_date !== undefined ? (b.due_date || null) : a.due_date;
    if (a.type === 'task' && !due) return c.json({ error: 'تاريخ الاستحقاق إلزامي للمهمة' }, 400);
    await c.env.DB.prepare(
      "UPDATE action_items SET text=?, priority=?, due_date=?, updated_at=datetime('now') WHERE id=?",
    ).bind(text, priority, due, id).run();
    if (Array.isArray(b.assignees)) {
      await c.env.DB.prepare('DELETE FROM action_assignees WHERE action_item_id = ?').bind(id).run();
      if (b.assignees.length) await c.env.DB.batch(b.assignees.map((uid: number) =>
        c.env.DB.prepare('INSERT OR IGNORE INTO action_assignees (action_item_id, user_id) VALUES (?, ?)').bind(id, Number(uid))));
    }
  }

  // تحديث الحالة/النسبة: للمدير أو المسؤول، في أي وقت
  if (b.status !== undefined || b.progress !== undefined) {
    if (!isManager && !assignee) return c.json({ error: 'لا تملك صلاحية تحديث الحالة' }, 403);
    const status = b.status !== undefined && STATUSES.includes(b.status) ? b.status : a.status;
    let progress = b.progress !== undefined ? Math.max(0, Math.min(100, Number(b.progress))) : a.progress;
    if (status === 'done') progress = 100;
    await c.env.DB.prepare(
      "UPDATE action_items SET status=?, progress=?, updated_at=datetime('now') WHERE id=?",
    ).bind(status, progress, id).run();
  }

  await audit(c.env, { userId: u.id, action: 'update_action', entityType: 'action_item', entityId: id, oldValue: { text: a.text, status: a.status }, newValue: b });
  return c.json({ ok: true });
});

// ---- إنجاز المهمة (المسؤول يضع علامة صح) ----
app.post('/:id/complete', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await loadAction(c.env, id);
  if (!a) return c.json({ error: 'البند غير موجود' }, 404);
  const u = c.get('user');
  const council = await getCouncil(c.env, a.council_id);
  if (!(await isAssignee(c.env, id, u.id)) && !isPresident(u) && !canEditDraft(u, council!, null))
    return c.json({ error: 'الإنجاز متاح للمسؤول عن البند' }, 403);
  if (a.status === 'done') return c.json({ error: 'البند منجز مسبقاً' }, 409);

  const { note } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare(
    `UPDATE action_items SET status='done', progress=100, completed_at=datetime('now'),
       completed_by=?, completion_note=?, original_completed_at=COALESCE(original_completed_at, datetime('now')),
       updated_at=datetime('now') WHERE id=?`,
  ).bind(u.id, note || null, id).run();
  await audit(c.env, { userId: u.id, action: 'complete_action', entityType: 'action_item', entityId: id });
  return c.json({ ok: true });
});

// ---- إعادة فتح ----
app.post('/:id/reopen', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await loadAction(c.env, id);
  if (!a) return c.json({ error: 'البند غير موجود' }, 404);
  const u = c.get('user');
  const council = await getCouncil(c.env, a.council_id);
  if (!isPresident(u) && !canEditDraft(u, council!, null) && !(await isAssignee(c.env, id, u.id)))
    return c.json({ error: 'لا تملك صلاحية' }, 403);
  await c.env.DB.prepare(
    "UPDATE action_items SET status='in_progress', completed_at=NULL, updated_at=datetime('now') WHERE id=?",
  ).bind(id).run();
  await audit(c.env, { userId: u.id, action: 'reopen_action', entityType: 'action_item', entityId: id });
  return c.json({ ok: true });
});

// ---- تعديل تاريخ الإنجاز يدوياً (يبقى الأصلي في التدقيق) ----
app.patch('/:id/completion-date', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await loadAction(c.env, id);
  if (!a) return c.json({ error: 'البند غير موجود' }, 404);
  const u = c.get('user');
  const council = await getCouncil(c.env, a.council_id);
  if (!canEditDraft(u, council!, null) && !isPresident(u)) return c.json({ error: 'لا تملك صلاحية' }, 403);
  if (a.status !== 'done') return c.json({ error: 'البند غير منجز' }, 400);
  const { completed_at } = await c.req.json().catch(() => ({}));
  if (!completed_at) return c.json({ error: 'التاريخ مطلوب' }, 400);
  await c.env.DB.prepare("UPDATE action_items SET completed_at=? WHERE id=?").bind(completed_at, id).run();
  await audit(c.env, {
    userId: u.id, action: 'adjust_completion_date', entityType: 'action_item', entityId: id,
    oldValue: { completed_at: a.completed_at, original: a.original_completed_at }, newValue: { completed_at },
  });
  return c.json({ ok: true });
});

// ---- رفع مرفق إثبات (R2) ----
app.put('/:id/attachments', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await loadAction(c.env, id);
  if (!a) return c.json({ error: 'البند غير موجود' }, 404);
  const u = c.get('user');
  if (!(await isAssignee(c.env, id, u.id)) && !isPresident(u)) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const fileName = c.req.query('name') || 'attachment';
  const key = `actions/${id}/${Date.now()}_${fileName}`;
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return c.json({ error: 'الملف فارغ' }, 400);
  await c.env.FILES.put(key, body);
  const res = await c.env.DB.prepare(
    'INSERT INTO action_attachments (action_item_id, r2_key, file_name, uploaded_by) VALUES (?, ?, ?, ?)',
  ).bind(id, key, fileName, u.id).run();
  return c.json({ id: res.meta.last_row_id, file_name: fileName }, 201);
});

app.get('/:id/attachments/:attId', async (c) => {
  const id = Number(c.req.param('id'));
  const attId = Number(c.req.param('attId'));
  const a = await loadAction(c.env, id);
  if (!a) return c.json({ error: 'البند غير موجود' }, 404);
  const council = await getCouncil(c.env, a.council_id);
  if (!(await canViewCouncil(c.env, c.get('user'), council!)) && !(await isAssignee(c.env, id, c.get('user').id)))
    return c.json({ error: 'لا تملك صلاحية' }, 403);
  const row = await c.env.DB.prepare('SELECT r2_key, file_name FROM action_attachments WHERE id = ? AND action_item_id = ?')
    .bind(attId, id).first<any>();
  if (!row) return c.json({ error: 'المرفق غير موجود' }, 404);
  const obj = await c.env.FILES.get(row.r2_key);
  if (!obj) return c.json({ error: 'الملف غير موجود' }, 404);
  return new Response(obj.body, {
    headers: { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}` },
  });
});

export default app;
