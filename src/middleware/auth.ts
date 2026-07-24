// وسيط المصادقة: يتحقق من كوكي الجلسة، ينتهي بعد ٨ ساعات خمول، ويحمّل المستخدم.
import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env, User, Variables } from '../types';

const IDLE_HOURS = 8;
export const SESSION_COOKIE = 'tarbawi_session';

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

export async function loadSession(c: Ctx): Promise<{ user: User; sessionId: string } | null> {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) return null;

  const row = await c.env.DB.prepare(
    `SELECT s.id AS sid, s.last_active,
            u.id, u.name, u.email, u.role, u.stage, u.signature_image,
            u.must_change_password, u.is_active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  )
    .bind(sid)
    .first<any>();

  if (!row) return null;
  if (!row.is_active) return null;

  // خمول ٨ ساعات
  const last = new Date((row.last_active as string).replace(' ', 'T') + 'Z').getTime();
  if (Date.now() - last > IDLE_HOURS * 3600 * 1000) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
    return null;
  }

  // تحديث آخر نشاط
  await c.env.DB.prepare("UPDATE sessions SET last_active = datetime('now') WHERE id = ?")
    .bind(sid)
    .run();

  const user: User = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    stage: row.stage,
    signature_image: row.signature_image,
    must_change_password: row.must_change_password,
    is_active: row.is_active,
  };
  return { user, sessionId: row.sid };
}

// يتطلب مصادقة صالحة
export async function requireAuth(c: Ctx, next: Next) {
  const s = await loadSession(c);
  if (!s) return c.json({ error: 'غير مصرّح — يجب تسجيل الدخول' }, 401);
  c.set('user', s.user);
  c.set('sessionId', s.sessionId);
  await next();
}

// يتطلب أن يكون المستخدم قد غيّر كلمة المرور (لكل الشاشات ما عدا تغيير كلمة المرور نفسها)
export async function requirePasswordChanged(c: Ctx, next: Next) {
  const user = c.get('user');
  if (user.must_change_password) {
    return c.json({ error: 'يجب تغيير كلمة المرور أولاً', code: 'MUST_CHANGE_PASSWORD' }, 403);
  }
  await next();
}

export function requireRole(...roles: string[]) {
  return async (c: Ctx, next: Next) => {
    const user = c.get('user');
    if (!roles.includes(user.role)) return c.json({ error: 'لا تملك صلاحية لهذه العملية' }, 403);
    await next();
  };
}
