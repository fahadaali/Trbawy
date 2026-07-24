// إنشاء الإشعارات داخل المنصة (وبريد اختياري عبر Resend).
import type { Env } from '../types';
import { sendEmail } from './mail';

export async function notify(
  env: Env,
  opts: { userId: number; type: string; title: string; body?: string; link?: string; email?: boolean },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)',
  ).bind(opts.userId, opts.type, opts.title, opts.body || null, opts.link || null).run();

  if (opts.email) {
    const u = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(opts.userId).first<{ email: string }>();
    if (u?.email) await sendEmail(env, u.email, opts.title, `<h3>${opts.title}</h3><p>${opts.body || ''}</p>`);
  }
}

// إشعار مجموعة مستخدمين
export async function notifyMany(
  env: Env,
  userIds: number[],
  opts: { type: string; title: string; body?: string; link?: string; email?: boolean },
): Promise<void> {
  for (const id of userIds) await notify(env, { userId: id, ...opts });
}
