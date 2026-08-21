// إدارة المستخدمين — لمدير النظام والرئيس. لا تسجيل ذاتي.
//
// كل عملية تُغيّر وضع المستخدم (دور/مرحلة، تعليق، حذف) تمرّ بثلاث مراحل:
//   ١) تقرير أثر يُحسب مسبقًا ويُعرض للمسؤول (GET /:id/impact)
//   ٢) موانع صريحة توقف التنفيذ ما لم يُؤكَّد بـ force مع تسجيل ذلك في التدقيق
//   ٣) تنفيذ ذرّي يضبط العضويات والكتابة والمهام وسجل فترات الأدوار
import { Hono } from 'hono';
import type { Env, Role, Stage, Variables } from '../types';
import { hashPassword } from '../lib/crypto';
import { audit } from '../lib/audit';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { canManageUsers } from '../permissions';
import { DEFAULT_PASSWORD } from '../lib/bootstrap';
import { defaultPersonColor, isValidColor } from '../lib/people';
import {
  computeImpact, loadUserRow, normalizeStage,
  applyRoleChange, applySuspension, applyReactivation,
  applySoftDelete, applyRestore, applyPurge,
  type LifecycleAction,
} from '../lib/userlifecycle';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireAuth, requirePasswordChanged);

// حارس الصلاحية
app.use('*', async (c, next) => {
  if (!canManageUsers(c.get('user'))) return c.json({ error: 'لا تملك صلاحية إدارة المستخدمين' }, 403);
  await next();
});

const VALID_ROLES = ['president', 'vice_president', 'first_supervisor', 'team_member', 'system_admin'];
const VALID_STAGES = ['secondary', 'middle'];
const VALID_ACTIONS: LifecycleAction[] = ['suspend', 'reactivate', 'delete', 'purge', 'restore', 'role_change'];

const truthy = (v: string | undefined) => v === '1' || v === 'true';

// قائمة المستخدمين (المحذوفون مستبعدون ما لم يُطلبوا صراحة)
app.get('/', async (c) => {
  const includeDeleted = truthy(c.req.query('include_deleted'));
  const rows = await c.env.DB.prepare(
    `SELECT id, name, email, deleted_email, role, stage, color, must_change_password, is_active,
            suspended_at, suspended_reason, deleted_at, created_at
       FROM users ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY deleted_at IS NOT NULL, role, name`,
  ).all<any>();
  // البريد المعروض للمحذوف هو بريده الأصلي لا البريد المحرَّر تقنيًا
  const users = rows.results.map((u: any) => ({ ...u, email: u.deleted_at ? (u.deleted_email || u.email) : u.email }));
  return c.json({ users });
});

// مرشّحو استلام المهام والرئاسة عند التعليق أو الحذف أو تغيير الدور
app.get('/:id/transfer-candidates', async (c) => {
  const id = Number(c.req.param('id'));
  const rows = await c.env.DB.prepare(
    `SELECT id, name, role, stage FROM users
      WHERE id != ? AND is_active = 1 AND deleted_at IS NULL
        AND role IN ('president','vice_president','first_supervisor','team_member')
      ORDER BY role, name`,
  ).bind(id).all<any>();
  return c.json({ candidates: rows.results });
});

// سجل فترات الأدوار — يوضّح نطاق الاطلاع التاريخي للمستخدم
app.get('/:id/role-history', async (c) => {
  const id = Number(c.req.param('id'));
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.role, p.stage, p.from_at, p.to_at, p.note, u.name AS changed_by_name
       FROM user_role_periods p LEFT JOIN users u ON u.id = p.changed_by
      WHERE p.user_id = ? ORDER BY p.id`,
  ).bind(id).all<any>();
  return c.json({ periods: rows.results });
});

// ---- تقرير الأثر قبل التنفيذ ----
// GET /users/:id/impact?action=role_change&role=team_member&stage=secondary&transfer_to=5
app.get('/:id/impact', async (c) => {
  const id = Number(c.req.param('id'));
  const action = (c.req.query('action') || '') as LifecycleAction;
  if (!VALID_ACTIONS.includes(action)) return c.json({ error: 'نوع العملية غير صالح' }, 400);
  const target = await loadUserRow(c.env, id);
  if (!target) return c.json({ error: 'المستخدم غير موجود' }, 404);

  const role = c.req.query('role') as Role | undefined;
  const stageQ = c.req.query('stage');
  if (action === 'role_change') {
    if (role && !VALID_ROLES.includes(role)) return c.json({ error: 'الدور غير صالح' }, 400);
    if (stageQ && !VALID_STAGES.includes(stageQ)) return c.json({ error: 'المرحلة غير صالحة' }, 400);
  }
  const impact = await computeImpact(c.env, c.get('user'), target, action, {
    role, stage: (stageQ || null) as Stage,
    transferTo: c.req.query('transfer_to') ? Number(c.req.query('transfer_to')) : null,
  });
  return c.json({ impact });
});

// إنشاء مستخدم (كلمة المرور الافتراضية مع إلزام التغيير)
app.post('/', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const name = (b.name || '').trim();
  const email = (b.email || '').trim().toLowerCase();
  const role = b.role;
  if (!name || !email) return c.json({ error: 'الاسم والبريد مطلوبان' }, 400);
  if (!VALID_ROLES.includes(role)) return c.json({ error: 'الدور غير صالح' }, 400);
  if (b.stage && !VALID_STAGES.includes(b.stage)) return c.json({ error: 'المرحلة غير صالحة' }, 400);
  const stage = normalizeStage(role, (b.stage || null) as Stage);
  if ((role === 'first_supervisor' || role === 'team_member') && !stage)
    return c.json({ error: 'يجب تحديد المرحلة لهذا الدور' }, 400);

  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (exists) return c.json({ error: 'البريد مستخدم مسبقاً' }, 409);

  if (b.color != null && b.color !== '' && !isValidColor(b.color))
    return c.json({ error: 'اللون غير صالح (يُتوقّع #RRGGBB)' }, 400);

  const pw = await hashPassword(DEFAULT_PASSWORD);
  const res = await c.env.DB.prepare(
    `INSERT INTO users (name, email, password_hash, role, stage, color, must_change_password, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
  )
    .bind(name, email, pw, role, stage, isValidColor(b.color) ? b.color : null)
    .run();

  const id = res.meta.last_row_id as number;
  // لون تمييز ثابت لمن لم يُختَر له لون — يبقى نفسه في كل المحاضر وكل المجالس
  if (!isValidColor(b.color)) {
    await c.env.DB.prepare('UPDATE users SET color = ? WHERE id = ?').bind(defaultPersonColor(id), id).run();
  }
  // فتح فترة الدور الأولى — أساس الاطلاع التاريخي لاحقًا
  await c.env.DB.prepare(
    "INSERT INTO user_role_periods (user_id, role, stage, changed_by, note) VALUES (?, ?, ?, ?, 'إنشاء الحساب')",
  ).bind(id, role, stage, c.get('user').id).run();

  await audit(c.env, { userId: c.get('user').id, action: 'create_user', entityType: 'user', entityId: id, newValue: { name, email, role, stage } });
  return c.json({ id, default_password: DEFAULT_PASSWORD }, 201);
});

// ---- تعديل مستخدم: الاسم، الدور/المرحلة، التعليق/التفعيل ----
// تغيير الدور أو المرحلة أو التعليق يمرّ بفحص الموانع أولًا، ويُنفَّذ بآثاره كاملة.
app.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const actor = c.get('user');
  const cur = await loadUserRow(c.env, id);
  if (!cur) return c.json({ error: 'المستخدم غير موجود' }, 404);
  if (cur.deleted_at) return c.json({ error: 'المستخدم محذوف — استعِده أولاً' }, 409);

  const name = b.name != null ? String(b.name).trim() : cur.name;
  const role = (b.role != null ? b.role : cur.role) as Role;
  if (!VALID_ROLES.includes(role)) return c.json({ error: 'الدور غير صالح' }, 400);
  const rawStage = b.stage !== undefined ? b.stage : cur.stage;
  if (rawStage && !VALID_STAGES.includes(rawStage)) return c.json({ error: 'المرحلة غير صالحة' }, 400);
  const stage = normalizeStage(role, (rawStage || null) as Stage);
  if ((role === 'first_supervisor' || role === 'team_member') && !stage)
    return c.json({ error: 'يجب تحديد المرحلة لهذا الدور' }, 400);

  const isActive = b.is_active != null ? (b.is_active ? 1 : 0) : cur.is_active;
  const force = !!b.force;
  const transferTo = b.transfer_to != null ? Number(b.transfer_to) : null;
  if (transferTo) {
    const ok = await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL')
      .bind(transferTo).first();
    if (!ok) return c.json({ error: 'المستخدم المنقول إليه غير موجود أو غير نشط' }, 400);
  }

  const roleChanged = role !== cur.role || (stage ?? null) !== (cur.stage ?? null);
  const suspending = cur.is_active === 1 && isActive === 0;
  const reactivating = cur.is_active === 0 && isActive === 1;

  // ---- فحص الموانع لكل عملية مطلوبة ----
  const impacts: Record<string, any> = {};
  for (const [key, action] of [
    ['role_change', 'role_change'], ['suspend', 'suspend'], ['reactivate', 'reactivate'],
  ] as [string, LifecycleAction][]) {
    const needed = (action === 'role_change' && roleChanged) || (action === 'suspend' && suspending) || (action === 'reactivate' && reactivating);
    if (!needed) continue;
    impacts[key] = await computeImpact(c.env, actor, cur, action, { role, stage, transferTo, force });
    if (impacts[key].blockers.length) {
      return c.json({
        error: 'العملية موقوفة: راجع الموانع أدناه ثم أعد الإرسال مع تأكيد (force) أو حدّد بديلاً.',
        code: 'BLOCKED', impact: impacts[key],
      }, 409);
    }
  }

  const effects: string[] = [];

  // لون التمييز: قابل للتعديل من إعدادات المستخدمين، ويسري بأثر رجعي على كل
  // المحاضر والمهام لأنه يُقرأ من المستخدم لا يُنسخ في البنود.
  if (b.color !== undefined) {
    if (b.color !== null && b.color !== '' && !isValidColor(b.color))
      return c.json({ error: 'اللون غير صالح (يُتوقّع #RRGGBB)' }, 400);
    const color = isValidColor(b.color) ? b.color : defaultPersonColor(id);
    if (color !== (cur as any).color) {
      await c.env.DB.prepare("UPDATE users SET color = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(color, id).run();
      await audit(c.env, {
        userId: actor.id, action: 'update_user', entityType: 'user', entityId: id,
        oldValue: { color: (cur as any).color }, newValue: { color },
      });
      effects.push('حُدِّث لون التمييز.');
    }
  }

  if (name !== cur.name) {
    await c.env.DB.prepare("UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(name, id).run();
    await audit(c.env, {
      userId: actor.id, action: 'update_user', entityType: 'user', entityId: id,
      oldValue: { name: cur.name }, newValue: { name },
    });
    effects.push('حُدِّث الاسم.');
  }

  if (roleChanged) {
    effects.push(...await applyRoleChange(c.env, actor, cur, { role, stage }, { transferTo, note: b.note || null }));
    if (force) await audit(c.env, { userId: actor.id, action: 'force_role_change', entityType: 'user', entityId: id, newValue: { blockers: impacts.role_change?.warnings } });
  }

  // بعد تغيير الدور نحمّل الصف المحدَّث حتى يعمل التعليق على وضعه الجديد
  const afterRole = roleChanged ? await loadUserRow(c.env, id) : cur;
  if (suspending) {
    effects.push(...await applySuspension(c.env, actor, afterRole, b.suspend_reason || null, { transferTo }));
    if (force) await audit(c.env, { userId: actor.id, action: 'force_suspend', entityType: 'user', entityId: id, newValue: { blockers: impacts.suspend?.warnings } });
  } else if (reactivating) {
    effects.push(...await applyReactivation(c.env, actor, afterRole));
  }

  return c.json({ ok: true, effects, impact: impacts.role_change || impacts.suspend || impacts.reactivate || null });
});

// ---- حذف مستخدم ----
// الافتراضي: حذف أرشيفي يحفظ كل السجلات الرسمية. purge=1: حذف نهائي لمن لا أثر له.
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const actor = c.get('user');
  const target = await loadUserRow(c.env, id);
  if (!target) return c.json({ error: 'المستخدم غير موجود' }, 404);

  const purge = truthy(c.req.query('purge'));
  const force = truthy(c.req.query('force'));
  const transferTo = c.req.query('transfer_to') ? Number(c.req.query('transfer_to')) : null;
  const reason = c.req.query('reason') || null;

  if (purge && !target.deleted_at) {
    return c.json({ error: 'الحذف النهائي لا يكون إلا بعد الحذف الأرشيفي — احذف المستخدم أولاً ثم احذفه نهائياً' }, 409);
  }
  if (!purge && target.deleted_at) {
    return c.json({ error: 'المستخدم محذوف مسبقاً' }, 409);
  }
  if (transferTo) {
    const ok = await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL')
      .bind(transferTo).first();
    if (!ok) return c.json({ error: 'المستخدم المنقول إليه غير موجود أو غير نشط' }, 400);
  }

  const action: LifecycleAction = purge ? 'purge' : 'delete';
  const impact = await computeImpact(c.env, actor, target, action, { transferTo, force });
  if (impact.blockers.length) {
    return c.json({
      error: 'الحذف موقوف: راجع الموانع أدناه، ثم حدّد من تنتقل إليه المسؤوليات أو أكّد الحذف.',
      code: 'BLOCKED', impact,
    }, 409);
  }

  const effects = purge
    ? await applyPurge(c.env, actor, target)
    : await applySoftDelete(c.env, actor, target, { transferTo, reason });
  if (force && !purge)
    await audit(c.env, { userId: actor.id, action: 'force_delete_user', entityType: 'user', entityId: id, newValue: { warnings: impact.warnings } });

  return c.json({ ok: true, purged: purge, effects, impact });
});

// ---- استعادة مستخدم محذوف (يعود معلَّقاً) ----
app.post('/:id/restore', async (c) => {
  const id = Number(c.req.param('id'));
  const target = await loadUserRow(c.env, id);
  if (!target) return c.json({ error: 'المستخدم غير موجود' }, 404);
  if (!target.deleted_at) return c.json({ error: 'المستخدم غير محذوف' }, 409);
  const effects = await applyRestore(c.env, c.get('user'), target);
  return c.json({ ok: true, effects });
});

// إعادة تعيين كلمة المرور للافتراضية مع إلزام التغيير
app.post('/:id/reset-password', async (c) => {
  const id = Number(c.req.param('id'));
  const target = await loadUserRow(c.env, id);
  if (!target) return c.json({ error: 'المستخدم غير موجود' }, 404);
  if (target.deleted_at) return c.json({ error: 'المستخدم محذوف' }, 409);
  const pw = await hashPassword(DEFAULT_PASSWORD);
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
  )
    .bind(pw, id)
    .run();
  // إبطال جلسات المستخدم
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  await audit(c.env, { userId: c.get('user').id, action: 'reset_password', entityType: 'user', entityId: id });
  return c.json({ ok: true, default_password: DEFAULT_PASSWORD });
});

export default app;
