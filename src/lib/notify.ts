// الإشعارات ثلاث قنوات: داخل التطبيق مضمون دائمًا، ودفعٌ إلى أجهزة المستخدم المشتركة
// (متصفح الجوال وتطبيق الشاشة الرئيسية)، وبريد عند ربط Resend.
// القناتان الأخيرتان أفضل-جهد: أي إخفاق فيهما يُتجاوَز ولا يُعطّل الإشعار أو العملية.
import type { Env } from '../types';
import { sendEmail } from './mail';
import { pushToUsers } from './pushnotify';

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

  // 2) دفعٌ إلى أجهزة المستخدم المشتركة (جوال/تطبيق الشاشة الرئيسية)
  await pushToUsers(env, [opts.userId], {
    title: opts.title, body: opts.body, link: opts.link, type: opts.type,
  });

  // 3) البريد — فقط عند ربط Resend، ولكل الإشعارات، وبتجاوز آمن لأي إخفاق
  if (!env.RESEND_API_KEY) return;
  try {
    const u = await env.DB.prepare('SELECT email FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL')
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

/**
 * إشعار جماعي: صفوف المنصة دفعة واحدة، ودفعٌ واحد لكل الأجهزة، ثم البريد بالتوازي.
 * لا نستدعي notify لكل مستخدم: ذلك يعني استعلامًا وإرسالًا مستقلًّا لكل واحد،
 * وهو ما يستهلك حصّة الطلبات الفرعية سريعًا في مجلس كبير.
 */
export async function notifyMany(
  env: Env,
  userIds: number[],
  opts: Omit<NotifyOpts, 'userId'>,
): Promise<void> {
  const ids = [...new Set(userIds.filter((n) => Number.isFinite(n)))];
  if (!ids.length) return;

  // 1) داخل التطبيق — دفعة واحدة
  await env.DB.batch(ids.map((id) => env.DB.prepare(
    'INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, opts.type, opts.title, opts.body || null, opts.link || null)));

  // 2) دفعٌ إلى أجهزة الجميع باستعلام واحد
  await pushToUsers(env, ids, { title: opts.title, body: opts.body, link: opts.link, type: opts.type });

  // 3) البريد — بالتوازي، وأي إخفاق فردي لا يُسقط الباقي
  if (!env.RESEND_API_KEY) return;
  const html = `<h3>${escHtml(opts.title)}</h3><p>${escHtml(opts.body || '')}</p>`;
  const users = (await env.DB.prepare(
    `SELECT email FROM users WHERE id IN (${ids.map(() => '?').join(',')})
       AND is_active = 1 AND deleted_at IS NULL`,
  ).bind(...ids).all<{ email: string }>()).results;
  await Promise.allSettled(users.map((u) => sendEmail(env, u.email, opts.title, html)));
}
