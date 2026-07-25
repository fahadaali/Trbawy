// الإشعارات: داخل التطبيق مضمون دائمًا، والبريد أفضل-جهد لكل الإشعارات عند ربط Resend.
// أي إخفاق في البريد (غير مُهيّأ، شبكة، تعذّر) يُتجاوَز بأمان ولا يُعطّل الإشعار أو العملية.
import type { Env } from '../types';
import { sendEmail } from './mail';

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface NotifyOpts {
  userId: number;
  type: string;
  title: string;
  body?: string;
  link?: string;
}

export async function notify(env: Env, opts: NotifyOpts): Promise<void> {
  // 1) داخل التطبيق — دائمًا (المصدر الموثوق للإشعارات)
  await env.DB.prepare(
    'INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)',
  ).bind(opts.userId, opts.type, opts.title, opts.body || null, opts.link || null).run();

  // 2) البريد — فقط عند ربط Resend، ولكل الإشعارات، وبتجاوز آمن لأي إخفاق
  if (!env.RESEND_API_KEY) return;
  try {
    const u = await env.DB.prepare('SELECT email FROM users WHERE id = ? AND is_active = 1')
      .bind(opts.userId)
      .first<{ email: string }>();
    if (u?.email) {
      // تهريب محتوى المستخدم (عناوين المحاضر، نصوص المهام) قبل وضعه في قالب HTML.
      const html = `<h3>${escHtml(opts.title)}</h3><p>${escHtml(opts.body || '')}</p>`;
      await sendEmail(env, u.email, opts.title, html);
    }
  } catch (e) {
    // لا نُفشل العملية بسبب البريد — الإشعار داخل التطبيق سُجِّل بالفعل.
    console.error('email notification failed (non-fatal)', e);
  }
}

export async function notifyMany(
  env: Env,
  userIds: number[],
  opts: Omit<NotifyOpts, 'userId'>,
): Promise<void> {
  // بالتوازي حتى لا يتراكم زمن الإرسال مع تعدّد المستهدفين؛ أي إخفاق فردي لا يُسقط الباقي.
  await Promise.allSettled(userIds.map((id) => notify(env, { userId: id, ...opts })));
}
