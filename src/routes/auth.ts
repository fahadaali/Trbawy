// مسارات المصادقة: دخول، خروج، الحساب الحالي، تغيير كلمة المرور.
import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import type { Env, Variables } from '../types';
import { hashPassword, verifyPassword, randomToken } from '../lib/crypto';
import { audit } from '../lib/audit';
import { requireAuth, SESSION_COOKIE } from '../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function clientIp(c: any): string | null {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
}

// تسجيل الدخول
app.post('/login', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  if (!email || !password) return c.json({ error: 'البريد وكلمة المرور مطلوبان' }, 400);

  const user = await c.env.DB.prepare(
    `SELECT id, name, email, password_hash, role, stage, must_change_password, is_active, deleted_at
       FROM users WHERE email = ? AND deleted_at IS NULL`,
  )
    .bind(String(email).trim().toLowerCase())
    .first<any>();

  if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'بيانات الدخول غير صحيحة' }, 401);
  }

  const sid = randomToken(32);
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, ip, user_agent) VALUES (?, ?, ?, ?)',
  )
    .bind(sid, user.id, clientIp(c), c.req.header('user-agent') || null)
    .run();

  setCookie(c, SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 8 * 3600,
  });

  await audit(c.env, { userId: user.id, action: 'login', entityType: 'user', entityId: user.id, ip: clientIp(c) });

  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      stage: user.stage,
      must_change_password: user.must_change_password,
    },
  });
});

// تسجيل الخروج
app.post('/logout', requireAuth, async (c) => {
  const sid = c.get('sessionId');
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// الحساب الحالي
app.get('/me', requireAuth, async (c) => {
  const u = c.get('user');
  return c.json({
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      stage: u.stage,
      must_change_password: u.must_change_password,
      signature_image: u.signature_image,
      // استثناءات هذا الحساب — تقرؤها الواجهة لتُخفي ما لا يملكه وتُظهر ما مُنح
      perms: u.perms || {},
    },
  });
});

// ---- الجلسات النشطة للحساب الحالي ----
// يرى المستخدم أجهزته المتصلة ويستطيع إنهاء أي منها عن بُعد.
app.get('/sessions', requireAuth, async (c) => {
  const u = c.get('user');
  const cur = c.get('sessionId');
  const rows = await c.env.DB.prepare(
    'SELECT id, created_at, last_active, ip, user_agent FROM sessions WHERE user_id = ? ORDER BY last_active DESC',
  ).bind(u.id).all<any>();
  return c.json({
    sessions: rows.results.map((r) => ({ ...r, is_current: r.id === cur })),
  });
});

// إنهاء جلسة بعينها (للحساب نفسه فقط)
app.delete('/sessions/:id', requireAuth, async (c) => {
  const u = c.get('user');
  const sid = c.req.param('id');
  if (sid === c.get('sessionId')) return c.json({ error: 'لإنهاء الجلسة الحالية استخدم تسجيل الخروج' }, 400);
  const res = await c.env.DB.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').bind(sid, u.id).run();
  if (!res.meta.changes) return c.json({ error: 'الجلسة غير موجودة' }, 404);
  await audit(c.env, { userId: u.id, action: 'revoke_session', entityType: 'session', ip: clientIp(c) });
  return c.json({ ok: true });
});

// إنهاء كل الجلسات الأخرى
app.post('/sessions/revoke-others', requireAuth, async (c) => {
  const u = c.get('user');
  const res = await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .bind(u.id, c.get('sessionId')).run();
  await audit(c.env, { userId: u.id, action: 'revoke_other_sessions', entityType: 'session', newValue: { count: res.meta.changes } });
  return c.json({ ok: true, revoked: res.meta.changes });
});

// تغيير كلمة المرور (متاح حتى مع must_change_password)
app.post('/change-password', requireAuth, async (c) => {
  const u = c.get('user');
  const { current_password, new_password } = await c.req.json().catch(() => ({}));
  if (!new_password || String(new_password).length < 6) {
    return c.json({ error: 'كلمة المرور الجديدة يجب أن تكون ٦ أحرف على الأقل' }, 400);
  }

  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(u.id)
    .first<{ password_hash: string }>();
  if (!row) return c.json({ error: 'المستخدم غير موجود' }, 404);

  // إن لم يكن ملزماً بالتغيير، نتحقق من كلمة المرور الحالية
  if (!u.must_change_password) {
    if (!current_password || !(await verifyPassword(current_password, row.password_hash))) {
      return c.json({ error: 'كلمة المرور الحالية غير صحيحة' }, 400);
    }
  }

  const newHash = await hashPassword(new_password);
  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(newHash, u.id)
    .run();

  // إبطال باقي الجلسات ما عدا الحالية
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .bind(u.id, c.get('sessionId'))
    .run();

  await audit(c.env, { userId: u.id, action: 'change_password', entityType: 'user', entityId: u.id, ip: clientIp(c) });

  return c.json({ ok: true });
});

export default app;
