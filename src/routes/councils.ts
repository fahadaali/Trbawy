// المجالس: العرض، العضوية، الكاتب الافتراضي، والبنود الثابتة.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { audit } from '../lib/audit';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { canManageUsers, canAssignWriter, canViewCouncil } from '../permissions';
import { sanitizeHtml } from '../lib/sanitize';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireAuth, requirePasswordChanged);

// قائمة المجالس مع الأعضاء (فقط ما يستطيع المستخدم رؤيته)
app.get('/', async (c) => {
  const u = c.get('user');
  const rows = await c.env.DB.prepare('SELECT * FROM councils ORDER BY id').all<any>();
  const visible = [];
  for (const council of rows.results) {
    if (await canViewCouncil(c.env, u, council)) visible.push(council);
  }
  return c.json({ councils: visible });
});

// تفاصيل مجلس + أعضاؤه + الكاتب الافتراضي
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const council = await c.env.DB.prepare('SELECT * FROM councils WHERE id = ?').bind(id).first<any>();
  if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
  if (!(await canViewCouncil(c.env, c.get('user'), council)))
    return c.json({ error: 'لا تملك صلاحية الاطلاع على هذا المجلس' }, 403);

  const members = await c.env.DB.prepare(
    `SELECT cm.user_id, cm.position, u.name, u.role, u.stage
       FROM council_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.council_id = ? ORDER BY cm.position DESC, u.name`,
  )
    .bind(id)
    .all();

  const fixed = await c.env.DB.prepare(
    'SELECT id, title, body, sort_order, is_active FROM fixed_agenda_templates WHERE council_id = ? ORDER BY sort_order',
  )
    .bind(id)
    .all();

  return c.json({ council, members: members.results, fixed_items: fixed.results });
});

// تعيين الكاتب الافتراضي للمجلس (صاحب صلاحية التعيين)
app.put('/:id/default-writer', async (c) => {
  const id = Number(c.req.param('id'));
  const { writer_id } = await c.req.json().catch(() => ({}));
  const council = await c.env.DB.prepare('SELECT * FROM councils WHERE id = ?').bind(id).first<any>();
  if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
  if (!canAssignWriter(c.get('user'), council))
    return c.json({ error: 'لا تملك صلاحية تعيين كاتب هذا المجلس' }, 403);

  // يجب أن يكون الكاتب عضواً في المجلس
  if (writer_id != null) {
    const member = await c.env.DB.prepare(
      'SELECT 1 FROM council_members WHERE council_id = ? AND user_id = ?',
    )
      .bind(id, writer_id)
      .first();
    if (!member) return c.json({ error: 'الكاتب يجب أن يكون عضواً في المجلس' }, 400);
  }

  await c.env.DB.prepare('UPDATE councils SET default_writer_id = ? WHERE id = ?')
    .bind(writer_id ?? null, id)
    .run();
  await audit(c.env, {
    userId: c.get('user').id, action: 'set_default_writer', entityType: 'council', entityId: id,
    oldValue: { writer: council.default_writer_id }, newValue: { writer: writer_id },
  });
  return c.json({ ok: true });
});

// إدارة العضوية (الرئيس/مدير النظام)
app.post('/:id/members', async (c) => {
  if (!canManageUsers(c.get('user'))) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const id = Number(c.req.param('id'));
  const { user_id, position } = await c.req.json().catch(() => ({}));
  const pos = position === 'chair' ? 'chair' : 'member';
  await c.env.DB.prepare(
    `INSERT INTO council_members (council_id, user_id, position) VALUES (?, ?, ?)
     ON CONFLICT(council_id, user_id) DO UPDATE SET position = excluded.position`,
  )
    .bind(id, user_id, pos)
    .run();
  await audit(c.env, { userId: c.get('user').id, action: 'add_council_member', entityType: 'council', entityId: id, newValue: { user_id, position: pos } });
  return c.json({ ok: true });
});

app.delete('/:id/members/:userId', async (c) => {
  if (!canManageUsers(c.get('user'))) return c.json({ error: 'لا تملك صلاحية' }, 403);
  const id = Number(c.req.param('id'));
  const userId = Number(c.req.param('userId'));
  await c.env.DB.prepare('DELETE FROM council_members WHERE council_id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  await audit(c.env, { userId: c.get('user').id, action: 'remove_council_member', entityType: 'council', entityId: id, oldValue: { user_id: userId } });
  return c.json({ ok: true });
});

// ---- البنود الثابتة (قالب لكل مجلس) ----
app.post('/:id/fixed-items', async (c) => {
  const id = Number(c.req.param('id'));
  const council = await c.env.DB.prepare('SELECT * FROM councils WHERE id = ?').bind(id).first<any>();
  if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
  if (!canAssignWriter(c.get('user'), council))
    return c.json({ error: 'لا تملك صلاحية تعديل بنود هذا المجلس' }, 403);
  const { title, body } = await c.req.json().catch(() => ({}));
  if (!title) return c.json({ error: 'العنوان مطلوب' }, 400);
  const max = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM fixed_agenda_templates WHERE council_id = ?',
  )
    .bind(id)
    .first<{ m: number }>();
  const res = await c.env.DB.prepare(
    'INSERT INTO fixed_agenda_templates (council_id, title, body, sort_order, is_active) VALUES (?, ?, ?, ?, 1)',
  )
    .bind(id, title, body ? sanitizeHtml(body) : null, (max?.m ?? -1) + 1)
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

app.delete('/:id/fixed-items/:itemId', async (c) => {
  const id = Number(c.req.param('id'));
  const council = await c.env.DB.prepare('SELECT * FROM councils WHERE id = ?').bind(id).first<any>();
  if (!council) return c.json({ error: 'المجلس غير موجود' }, 404);
  if (!canAssignWriter(c.get('user'), council))
    return c.json({ error: 'لا تملك صلاحية' }, 403);
  await c.env.DB.prepare('DELETE FROM fixed_agenda_templates WHERE id = ? AND council_id = ?')
    .bind(Number(c.req.param('itemId')), id)
    .run();
  return c.json({ ok: true });
});

export default app;
