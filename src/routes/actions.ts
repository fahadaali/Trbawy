// القرارات والتوصيات والمهام — كيان مستقل، لوحة مهامي، الإنجاز، المرفقات.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { audit } from '../lib/audit';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { councilScope, withinAccessWindow, isOpenAction, canEditDraft, isPresident, isVice, hasFullCouncilAccess, type CouncilRow } from '../permissions';
import { getCouncil, nextActionNumber, formatActionNumber } from '../lib/meetings';
import { notify, notifyMany } from '../lib/notify';
import { recomputeDelay, assigneeStats, overallStats, stalledActions } from '../lib/taskmetrics';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

const TYPES = ['decision', 'recommendation', 'task'];
const STATUSES = ['not_started', 'in_progress', 'done', 'stalled', 'cancelled'];
const PRIORITIES = ['high', 'medium', 'low'];
const EDITABLE_MEETING = ['invitation', 'draft', 'awaiting_signatures'];

async function loadAction(env: Env, id: number) {
  return await env.DB.prepare('SELECT * FROM action_items WHERE id = ?').bind(id).first<any>();
}
// كاتب المحضر المصدر — يجب تمريره لـ canEditDraft وإلا حُرم الكاتب المعيَّن من صلاحياته.
async function meetingWriterOf(env: Env, meetingId: number): Promise<number | null> {
  const m = await env.DB.prepare('SELECT writer_id FROM meetings WHERE id = ?').bind(meetingId).first<any>();
  return m?.writer_id ?? null;
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

// الاطلاع على بند: محضره أُنشئ داخل نافذة اطلاعه، أو بند مفتوح في مجلس يملك اطلاعًا
// كاملًا عليه الآن (عمل جارٍ لا أرشيف)، أو كونه مسؤولًا عنه — فالمسؤول يرى بنده دائمًا.
async function canViewAction(
  env: Env, u: any,
  action: { id: number; council_id: number; source_meeting_id: number; status?: string },
  council: CouncilRow,
): Promise<boolean> {
  const scope = await councilScope(env, u, council);
  if (scope.level !== 'none') {
    const m = await env.DB.prepare('SELECT created_at FROM meetings WHERE id = ?')
      .bind(action.source_meeting_id).first<any>();
    if (withinAccessWindow(m?.created_at, scope.windows)) return true;
    if (scope.level === 'full' && isOpenAction(action.status)) return true;
  }
  return await isAssignee(env, action.id, u.id);
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

  // first_due_date يُثبَّت مرة واحدة: أي تمديد لاحق يبقى مرئيًا مقابل الوعد الأصلي
  const res = await c.env.DB.prepare(
    `INSERT INTO action_items (type, council_id, source_meeting_id, number, display_number, text,
       priority, due_date, first_due_date, status, progress)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started', 0)`,
  ).bind(type, council!.id, meetingId, number, display, text, priority, b.due_date || null, b.due_date || null).run();
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
            a.delay_days, a.carried_count, a.first_due_date,
            (SELECT GROUP_CONCAT(us.name, '، ') FROM action_assignees ax
               JOIN users us ON us.id = ax.user_id WHERE ax.action_item_id = a.id) AS assignees,
            CASE WHEN a.status NOT IN ('done','cancelled') AND a.due_date IS NOT NULL AND a.due_date < date('now')
                 THEN CAST(julianday(date('now')) - julianday(date(a.due_date)) AS INTEGER) ELSE 0 END AS overdue_days,
            co.name AS council_name, co.type AS council_type,
            m.display_number AS meeting_number, m.created_at AS meeting_created_at
       FROM action_items a
       JOIN councils co ON co.id = a.council_id
       LEFT JOIN meetings m ON m.id = a.source_meeting_id
       ${join} ${whereSql}
      ORDER BY a.status='done', a.due_date IS NULL, a.due_date, a.id DESC LIMIT 400`,
  ).bind(...binds).all<any>();

  // تصفية دقيقة: اطلاع كامل، أو أرشيف فترة الخدمة السابقة، أو كونه مسؤولًا عن البند
  const assigned = new Set<number>(
    (await c.env.DB.prepare('SELECT action_item_id FROM action_assignees WHERE user_id = ?')
      .bind(u.id).all<{ action_item_id: number }>()).results.map((r) => r.action_item_id),
  );
  const scopes = new Map<number, Awaited<ReturnType<typeof councilScope>>>();
  const out = [];
  for (const a of rows.results) {
    if (mine) { out.push(a); continue; }
    let scope = scopes.get(a.council_id);
    if (!scope) {
      scope = await councilScope(c.env, u, { id: a.council_id, type: a.council_type, default_writer_id: null });
      scopes.set(a.council_id, scope);
    }
    const visible = withinAccessWindow(a.meeting_created_at, scope.windows)
      || (scope.level === 'full' && isOpenAction(a.status))
      || assigned.has(a.id);
    if (visible) out.push({ ...a, read_only: scope.level !== 'full' });
  }
  return c.json({ actions: out });
});

// ---- لوحة الالتزام: نسبة الإنجاز ودقة التوقيت والتأخير لكل مكلَّف ----
// الاطلاع الكامل على المجلس يرى الجميع، ومن دونه يرى بياناته وحدها.
app.get('/stats', async (c) => {
  const u = c.get('user');
  const councilId = Number(c.req.query('council_id')) || null;
  const type = TYPES.includes(c.req.query('type') || '') ? c.req.query('type')! : null;
  const from = c.req.query('from') || null;
  const to = c.req.query('to') || null;

  let full = isPresident(u) || isVice(u);
  if (councilId) {
    const council = await getCouncil(c.env, councilId);
    if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
    full = hasFullCouncilAccess(u, council);
  }
  const scoped = { councilId, type, from, to };
  const asked = Number(c.req.query('user_id')) || null;
  const userId = full ? asked : u.id;

  const [board, overall, stalled] = await Promise.all([
    assigneeStats(c.env, { ...scoped, userId }),
    overallStats(c.env, { ...scoped, userId }),
    full ? stalledActions(c.env, scoped) : Promise.resolve([]),
  ]);
  return c.json({ scope: full ? 'full' : 'self', board, overall, stalled });
});

// ---- تفاصيل ----
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await loadAction(c.env, id);
  if (!a) return c.json({ error: 'البند غير موجود' }, 404);
  const council = await getCouncil(c.env, a.council_id);
  if (!(await canViewAction(c.env, c.get('user'), a, council!)))
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
      `UPDATE action_items SET text=?, priority=?, due_date=?,
         first_due_date=COALESCE(first_due_date, ?), updated_at=datetime('now') WHERE id=?`,
    ).bind(text, priority, due, due, id).run();
    if (due !== a.due_date) await recomputeDelay(c.env, id);
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
    // الانتقال إلى «منجزة» من هنا يُسجَّل كما يُسجَّل من زر الإنجاز: تاريخ ومُنجِز وتأخير
    const becameDone = status === 'done' && a.status !== 'done';
    await c.env.DB.prepare(
      `UPDATE action_items SET status=?, progress=?,
         completed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE completed_at END,
         completed_by = CASE WHEN ? = 1 THEN ? ELSE completed_by END,
         original_completed_at = CASE WHEN ? = 1 THEN COALESCE(original_completed_at, datetime('now')) ELSE original_completed_at END,
         updated_at=datetime('now') WHERE id=?`,
    ).bind(status, progress, becameDone ? 1 : 0, becameDone ? 1 : 0, u.id, becameDone ? 1 : 0, id).run();
    if (becameDone || status !== a.status) await recomputeDelay(c.env, id);
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
  const writerId = await meetingWriterOf(c.env, a.source_meeting_id);
  if (!(await isAssignee(c.env, id, u.id)) && !isPresident(u) && !canEditDraft(u, council!, writerId))
    return c.json({ error: 'الإنجاز متاح للمسؤول عن البند' }, 403);
  if (a.status === 'done') return c.json({ error: 'البند منجز مسبقاً' }, 409);

  const { note } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare(
    `UPDATE action_items SET status='done', progress=100, completed_at=datetime('now'),
       completed_by=?, completion_note=?, original_completed_at=COALESCE(original_completed_at, datetime('now')),
       updated_at=datetime('now') WHERE id=?`,
  ).bind(u.id, note || null, id).run();
  await recomputeDelay(c.env, id);
  await audit(c.env, { userId: u.id, action: 'complete_action', entityType: 'action_item', entityId: id });
  return c.json({ ok: true });
});

// ---- تفويض/إعادة إسناد المهمة إلى شخص آخر ----
app.post('/:id/delegate', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await loadAction(c.env, id);
  if (!a) return c.json({ error: 'البند غير موجود' }, 404);
  const u = c.get('user');
  const council = await getCouncil(c.env, a.council_id);
  const writerId = await meetingWriterOf(c.env, a.source_meeting_id);
  // يفوّض: المسؤول الحالي، أو المدير (رئيس/مشرف/كاتب)
  const mine = await isAssignee(c.env, id, u.id);
  if (!mine && !isPresident(u) && !canEditDraft(u, council!, writerId))
    return c.json({ error: 'التفويض متاح للمسؤول عن البند أو مدير المجلس' }, 403);
  if (a.status === 'done' || a.status === 'cancelled')
    return c.json({ error: 'لا يمكن تفويض بند منتهٍ' }, 409);

  const { to_user_id, keep_me, note } = await c.req.json().catch(() => ({}));
  const target = Number(to_user_id);
  if (!target) return c.json({ error: 'حدد الشخص المفوَّض إليه' }, 400);
  // يجب أن يكون عضوًا في نفس المجلس
  const isMember = await c.env.DB.prepare('SELECT 1 FROM council_members WHERE council_id = ? AND user_id = ?')
    .bind(a.council_id, target).first();
  if (!isMember) return c.json({ error: 'المفوَّض إليه يجب أن يكون عضوًا في المجلس' }, 400);

  await c.env.DB.prepare('INSERT OR IGNORE INTO action_assignees (action_item_id, user_id) VALUES (?, ?)')
    .bind(id, target).run();
  // إزالة المفوِّض ما لم يطلب البقاء
  if (mine && !keep_me) {
    await c.env.DB.prepare('DELETE FROM action_assignees WHERE action_item_id = ? AND user_id = ?')
      .bind(id, u.id).run();
  }
  await notify(c.env, {
    userId: target, type: 'action_delegated', title: 'تفويض مهمة إليك',
    body: `${a.display_number} — ${a.text}${note ? ' | ' + note : ''}`, link: `#/tasks/${id}`,
  });
  await audit(c.env, {
    userId: u.id, action: 'delegate_action', entityType: 'action_item', entityId: id,
    newValue: { to: target, keep_me: !!keep_me, note: note || null },
  });
  return c.json({ ok: true });
});

// أعضاء المجلس المرشّحون للتفويض
app.get('/:id/delegate-candidates', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await loadAction(c.env, id);
  if (!a) return c.json({ error: 'البند غير موجود' }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT cm.user_id, u.name, u.role FROM council_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.council_id = ? AND u.is_active = 1 AND u.deleted_at IS NULL ORDER BY u.name`,
  ).bind(a.council_id).all();
  return c.json({ candidates: rows.results });
});

// ---- إعادة فتح ----
app.post('/:id/reopen', async (c) => {
  const id = Number(c.req.param('id'));
  const a = await loadAction(c.env, id);
  if (!a) return c.json({ error: 'البند غير موجود' }, 404);
  const u = c.get('user');
  const council = await getCouncil(c.env, a.council_id);
  if (!isPresident(u) && !canEditDraft(u, council!, await meetingWriterOf(c.env, a.source_meeting_id)) && !(await isAssignee(c.env, id, u.id)))
    return c.json({ error: 'لا تملك صلاحية' }, 403);
  await c.env.DB.prepare(
    "UPDATE action_items SET status='in_progress', completed_at=NULL, delay_days=NULL, updated_at=datetime('now') WHERE id=?",
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
  if (!canEditDraft(u, council!, await meetingWriterOf(c.env, a.source_meeting_id)) && !isPresident(u))
    return c.json({ error: 'لا تملك صلاحية' }, 403);
  if (a.status !== 'done') return c.json({ error: 'البند غير منجز' }, 400);
  const { completed_at } = await c.req.json().catch(() => ({}));
  if (!completed_at) return c.json({ error: 'التاريخ مطلوب' }, 400);
  await c.env.DB.prepare("UPDATE action_items SET completed_at=? WHERE id=?").bind(completed_at, id).run();
  await recomputeDelay(c.env, id);
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
  if (!(await canViewAction(c.env, c.get('user'), a, council!)))
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
