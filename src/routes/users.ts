// إدارة المستخدمين — لمدير النظام والرئيس. لا تسجيل ذاتي.
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { hashPassword } from '../lib/crypto';
import { audit } from '../lib/audit';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { canManageUsers } from '../permissions';
import { DEFAULT_PASSWORD } from '../lib/bootstrap';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireAuth, requirePasswordChanged);

// حارس الصلاحية
app.use('*', async (c, next) => {
  if (!canManageUsers(c.get('user'))) return c.json({ error: 'لا تملك صلاحية إدارة المستخدمين' }, 403);
  await next();
});

const VALID_ROLES = ['president', 'vice_president', 'first_supervisor', 'team_member', 'system_admin'];
const VALID_STAGES = ['secondary', 'middle'];

// قائمة المستخدمين
app.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, name, email, role, stage, must_change_password, is_active, created_at
       FROM users ORDER BY role, name`,
  ).all();
  return c.json({ users: rows.results });
});

// إنشاء مستخدم (كلمة المرور الافتراضية مع إلزام التغيير)
app.post('/', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const name = (b.name || '').trim();
  const email = (b.email || '').trim().toLowerCase();
  const role = b.role;
  const stage = b.stage || null;

  if (!name || !email) return c.json({ error: 'الاسم والبريد مطلوبان' }, 400);
  if (!VALID_ROLES.includes(role)) return c.json({ error: 'الدور غير صالح' }, 400);
  if (stage && !VALID_STAGES.includes(stage)) return c.json({ error: 'المرحلة غير صالحة' }, 400);
  if ((role === 'first_supervisor' || role === 'team_member') && !stage)
    return c.json({ error: 'يجب تحديد المرحلة لهذا الدور' }, 400);

  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (exists) return c.json({ error: 'البريد مستخدم مسبقاً' }, 409);

  const pw = await hashPassword(DEFAULT_PASSWORD);
  const res = await c.env.DB.prepare(
    `INSERT INTO users (name, email, password_hash, role, stage, must_change_password, is_active)
     VALUES (?, ?, ?, ?, ?, 1, 1)`,
  )
    .bind(name, email, pw, role, stage)
    .run();

  const id = res.meta.last_row_id;
  await audit(c.env, { userId: c.get('user').id, action: 'create_user', entityType: 'user', entityId: id, newValue: { name, email, role, stage } });
  return c.json({ id, default_password: DEFAULT_PASSWORD }, 201);
});

// تعديل مستخدم
app.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const cur = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  if (!cur) return c.json({ error: 'المستخدم غير موجود' }, 404);

  const name = b.name != null ? String(b.name).trim() : cur.name;
  const role = b.role != null ? b.role : cur.role;
  const stage = b.stage !== undefined ? b.stage : cur.stage;
  const isActive = b.is_active != null ? (b.is_active ? 1 : 0) : cur.is_active;

  if (!VALID_ROLES.includes(role)) return c.json({ error: 'الدور غير صالح' }, 400);
  if (stage && !VALID_STAGES.includes(stage)) return c.json({ error: 'المرحلة غير صالحة' }, 400);

  await c.env.DB.prepare(
    "UPDATE users SET name = ?, role = ?, stage = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(name, role, stage, isActive, id)
    .run();

  await audit(c.env, {
    userId: c.get('user').id, action: 'update_user', entityType: 'user', entityId: id,
    oldValue: { name: cur.name, role: cur.role, stage: cur.stage, is_active: cur.is_active },
    newValue: { name, role, stage, is_active: isActive },
  });
  return c.json({ ok: true });
});

// إعادة تعيين كلمة المرور للافتراضية مع إلزام التغيير
app.post('/:id/reset-password', async (c) => {
  const id = Number(c.req.param('id'));
  const pw = await hashPassword(DEFAULT_PASSWORD);
  const res = await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
  )
    .bind(pw, id)
    .run();
  if (!res.meta.changes) return c.json({ error: 'المستخدم غير موجود' }, 404);
  // إبطال جلسات المستخدم
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  await audit(c.env, { userId: c.get('user').id, action: 'reset_password', entityType: 'user', entityId: id });
  return c.json({ ok: true, default_password: DEFAULT_PASSWORD });
});

export default app;
